import { AppError } from '@wechatgram/protocol'
import type {
  AuthState,
  ChatSummary,
  ConnectionState,
  Message,
  MessageEntity,
  ProxyConfig,
  ProxyTestResult,
  Self,
  Sticker,
  StickerSet,
  StickerSetSummary,
} from '@wechatgram/protocol'
import { getTdjson } from 'prebuilt-tdlib'
import { configure, createClient } from 'tdl'

import { probeImageSize } from '../media/image-size'
import { registerMediaFile } from '../media/registry'
import { createLogger, toAdapterError } from '../util'
import { AdapterEmitter, type MediaKind, type TelegramAdapter } from './adapter'

/* TDLib responses are a 2MB generated type space; the adapter boundary is the
 * only place allowed to touch raw JSON, so it stays `unknown`-ish here and is
 * mapped into domain DTOs immediately. */
type TdObject = Record<string, any>

interface TdClientLike {
  invoke(method: TdObject): Promise<any>
  on(event: 'update', handler: (update: TdObject) => void): void
  on(event: 'error', handler: (error: Error) => void): void
  on(event: 'close', handler: () => void): void
  close(): Promise<void>
  getVersion(): string
}

let tdlibConfigured = false

function configureTdlib(logger: ReturnType<typeof createLogger>): void {
  if (tdlibConfigured) return
  configure({ tdjson: getTdjson(), verbosityLevel: 1 })
  tdlibConfigured = true
  logger.info('TDLib configured with prebuilt tdjson')
}

const ENTITY_TYPES: Record<string, MessageEntity['type']> = {
  textEntityTypeBold: 'bold',
  textEntityTypeItalic: 'italic',
  textEntityTypeUnderline: 'underline',
  textEntityTypeStrikethrough: 'strikethrough',
  textEntityTypeCode: 'code',
  textEntityTypePre: 'pre',
  textEntityTypePreCode: 'pre',
  textEntityTypeUrl: 'url',
  textEntityTypeTextUrl: 'textUrl',
  textEntityTypeMention: 'mention',
  textEntityTypeHashtag: 'hashtag',
  textEntityTypeSpoiler: 'spoiler',
  textEntityTypeCustomEmoji: 'customEmoji',
}

/** Parallel chat-photo downloads; TDLib serialises internals anyway. */
const AVATAR_WORKERS = 4
/** Coalescing window for pushing finished avatars back to the renderer. */
const AVATAR_FLUSH_MS = 120

export interface TdlibAdapterOptions {
  apiId: number
  apiHash: string
  databaseDirectory: string
  filesDirectory: string
  initialProxy: ProxyConfig | null
}

/**
 * Real protocol adapter. Only this file may import `tdl` (design doc §2).
 *
 * Authorization is driven manually instead of `client.login()`, because the UI
 * needs explicit steps (`auth:start` → `auth:code` → `auth:password`).
 */
export class TdlibAdapter extends AdapterEmitter implements TelegramAdapter {
  readonly kind = 'tdlib' as const
  readonly label = 'TDLib'

  private readonly logger = createLogger('tdlib')
  private client: TdClientLike | null = null
  private auth: AuthState = { kind: 'idle' }
  private connection: ConnectionState = 'offline'
  private proxy: ProxyConfig | null = null
  private readonly userNames = new Map<number, string>()
  /** Chat titles, used for `messageSenderChat` (channel posts, anonymous admins). */
  private readonly chatTitles = new Map<number, string>()
  /** Sticker file id → pixel size, so the picker can send without a lookup. */
  private readonly stickerSizes = new Map<number, { width: number; height: number }>()
  /** Our own user id, learnt from `getMe`; drives the rail avatar. */
  private selfUserId: number | null = null
  /** Profile photo file id → `wx-media://` URL, so it is downloaded once. */
  private selfAvatarFileId: number | null = null
  private selfAvatarUrl: string | null = null
  /** Chat photos: chat id → known photo file id / `wx-media://` URL. */
  private readonly chatAvatarFiles = new Map<number, number>()
  private readonly chatAvatarUrls = new Map<number, string>()
  /** Chats whose photo is known to be absent — never asked again. */
  private readonly chatAvatarMisses = new Set<number>()
  private readonly avatarQueue: number[] = []
  /** Chats whose photo download is running — keeps list and updates from duplicating. */
  private readonly avatarInFlight = new Set<number>()
  private avatarWorkers = 0
  private avatarFlushTimer: NodeJS.Timeout | null = null
  private readonly pendingAvatarUpserts = new Set<number>()

  constructor(private readonly options: TdlibAdapterOptions) {
    super()
  }

  async start(): Promise<void> {
    if (this.client) return
    configureTdlib(this.logger)

    this.client = createClient({
      apiId: this.options.apiId,
      apiHash: this.options.apiHash,
      databaseDirectory: this.options.databaseDirectory,
      filesDirectory: this.options.filesDirectory,
      tdlibParameters: {
        use_message_database: true,
        use_secret_chats: false,
        system_language_code: 'zh-hans',
        application_version: '0.1.0',
        device_model: 'WechatGram Desktop',
        system_version: 'Windows',
      },
    }) as unknown as TdClientLike

    this.client.on('update', (update) => {
      void this.handleUpdate(update).catch((error) => {
        this.logger.warn('update handler failed:', error instanceof Error ? error.message : error)
      })
    })
    this.client.on('error', (error) => this.logger.warn('client error:', error.message))
    this.client.on('close', () => this.setAuth({ kind: 'closed' }))

    // Proxy must be in place before any network request (§6.4). tdl queues
    // requests until it has sent the TDLib parameters, so calling it here is
    // both safe and early enough.
    if (this.options.initialProxy) {
      const proxy = this.options.initialProxy
      void this.applyProxy(proxy)
        .then(() =>
          this.logger.info(`initial proxy applied: ${proxy.type} ${proxy.host}:${proxy.port}`),
        )
        .catch((error) =>
          this.logger.warn(
            'initial proxy failed:',
            error instanceof Error ? error.message : String(error),
          ),
        )
    }

    // Version is only known once TDLib emits its first update, so it is not
    // available here; report it when authorization settles instead.
    this.logger.info('TDLib client created')
  }

  async stop(): Promise<void> {
    if (!this.client) return
    try {
      await this.client.close()
    } finally {
      this.client = null
    }
  }

  getAuthState(): AuthState {
    return this.auth
  }

  getConnectionState(): ConnectionState {
    return this.connection
  }

  async submitPhone(phone: string): Promise<AuthState> {
    await this.invoke({ _: 'setAuthenticationPhoneNumber', phone_number: phone, settings: null })
    return this.auth
  }

  async submitCode(code: string): Promise<AuthState> {
    await this.invoke({ _: 'checkAuthenticationCode', code })
    return this.auth
  }

  async submitPassword(password: string): Promise<AuthState> {
    await this.invoke({ _: 'checkAuthenticationPassword', password })
    return this.auth
  }

  async logout(): Promise<void> {
    await this.invoke({ _: 'logOut' })
    this.userNames.clear()
  }

  async me(): Promise<Self> {
    const raw = await this.invoke({ _: 'getMe' })
    this.selfUserId = raw.id
    const fileId: number | undefined = raw.profile_photo?.small?.id ?? raw.profile_photo?.big?.id
    // Already fetched: hand the renderer the picture with the profile in one go.
    if (fileId && this.selfAvatarFileId === fileId && this.selfAvatarUrl) {
      return { ...this.mapUser(raw), avatarUrl: this.selfAvatarUrl }
    }
    // Otherwise fetch it in the background and announce it with a fresh auth
    // event — authorisation must not wait for a network round trip.
    if (fileId) void this.loadSelfAvatar(fileId)
    return this.mapUser(raw)
  }

  /**
   * Downloads our own profile photo (the small size the rail uses) and re-emits
   * the ready auth state so the avatar can replace the initials. Best effort:
   * the account still works without a picture.
   */
  private async loadSelfAvatar(fileId: number): Promise<void> {
    if (this.selfAvatarFileId === fileId && this.selfAvatarUrl) return
    try {
      const { url } = await this.downloadFile({ fileId, priority: 32 })
      this.selfAvatarFileId = fileId
      this.selfAvatarUrl = url
      if (this.auth.kind === 'ready') {
        this.setAuth({ kind: 'ready', me: { ...this.auth.me, avatarUrl: url } })
      }
    } catch (error) {
      this.logger.warn(
        `profile photo ${fileId} could not be downloaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  async listChats(input: { limit: number; offset: number }): Promise<ChatSummary[]> {
    // TDLib has no offset for getChats: fetch enough ids and slice (§6.3).
    const response = await this.invoke({
      _: 'getChats',
      chat_list: { _: 'chatListMain' },
      limit: input.offset + input.limit,
    })
    const ids: number[] = Array.isArray(response.chat_ids) ? response.chat_ids : []
    const page = ids.slice(input.offset, input.offset + input.limit)
    const summaries = await Promise.all(page.map((id) => this.fetchChatSummary(id)))
    // Photos come second: the rows must not wait for one network round trip per
    // chat, so they are downloaded in the background and pushed as `chats` ops.
    void this.prefetchChatAvatars(page)
    return summaries
  }

  /**
   * Downloads chat photos with a small worker pool and pushes the finished ones
   * back as batched `chats` upserts. Only the small (thumbnail) size is fetched;
   * failures are remembered so a chat without a usable photo is not retried.
   */
  private async prefetchChatAvatars(chatIds: number[]): Promise<void> {
    for (const chatId of chatIds) {
      if (this.chatAvatarUrls.has(chatId)) continue
      if (this.chatAvatarMisses.has(chatId)) continue
      if (this.avatarInFlight.has(chatId)) continue
      if (this.avatarQueue.includes(chatId)) continue
      this.avatarQueue.push(chatId)
    }
    while (this.avatarWorkers < AVATAR_WORKERS && this.avatarQueue.length > 0) {
      this.avatarWorkers += 1
      void this.runAvatarWorker()
    }
  }

  private async runAvatarWorker(): Promise<void> {
    try {
      for (;;) {
        const chatId = this.avatarQueue.shift()
        if (chatId === undefined) return
        this.avatarInFlight.add(chatId)
        try {
          await this.resolveChatAvatar(chatId)
        } finally {
          this.avatarInFlight.delete(chatId)
        }
      }
    } finally {
      this.avatarWorkers -= 1
    }
  }

  private async resolveChatAvatar(chatId: number): Promise<void> {
    try {
      const chat = await this.invoke({ _: 'getChat', chat_id: chatId })
      const fileId: number | undefined = chat.photo?.small?.id ?? chat.photo?.big?.id
      if (!fileId) {
        this.chatAvatarMisses.add(chatId)
        return
      }
      if (this.chatAvatarFiles.get(chatId) === fileId && this.chatAvatarUrls.has(chatId)) return
      const { path } = await this.fetchFilePath(fileId, 1)
      this.chatAvatarFiles.set(chatId, fileId)
      this.chatAvatarUrls.set(chatId, registerMediaFile(path))
      this.queueAvatarUpsert(chatId)
    } catch (error) {
      this.chatAvatarMisses.add(chatId)
      this.logger.warn(
        `chat ${chatId} photo could not be downloaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /** Batches finished avatars into one `chats` event instead of one per chat. */
  private queueAvatarUpsert(chatId: number): void {
    this.pendingAvatarUpserts.add(chatId)
    if (this.avatarFlushTimer) return
    this.avatarFlushTimer = setTimeout(() => {
      this.avatarFlushTimer = null
      void this.flushAvatarUpserts()
    }, AVATAR_FLUSH_MS)
  }

  private async flushAvatarUpserts(): Promise<void> {
    const chatIds = [...this.pendingAvatarUpserts]
    this.pendingAvatarUpserts.clear()
    const ops: { op: 'upsert'; chat: ChatSummary }[] = []
    for (const chatId of chatIds) {
      try {
        ops.push({ op: 'upsert', chat: await this.fetchChatSummary(chatId) })
      } catch {
        // Removed between download and flush.
      }
    }
    if (ops.length > 0) this.emit({ type: 'chats', ops })
  }

  async getChat(chatId: number): Promise<ChatSummary> {
    return this.fetchChatSummary(chatId)
  }

  async openChat(chatId: number): Promise<void> {
    const history = await this.history({ chatId, limit: 1 })
    const latest = history.messages.at(-1)
    if (latest) await this.markRead({ chatId, upToMessageId: latest.id })
  }

  /**
   * One page of history, ascending, plus whether older messages may exist.
   *
   * Measured quirk that made groups look unloadable: `getChatHistory` happily
   * answers from the local database and then returns only the handful of
   * messages it has cached — 1 to 5 for a cold group, in ~2 ms — even when the
   * chat has thousands of messages. Anchoring *below* that short answer is the
   * request TDLib does take to the server, and it comes back full. So a short
   * answer is topped up here, and only an empty round counts as "the chat
   * begins here".
   *
   * The old `hasMore: rawMessages.length >= limit` read every short answer as
   * "no more history", which stopped MessageList from paging at all.
   */
  async history(input: {
    chatId: number
    fromMessageId?: number
    limit: number
  }): Promise<{ messages: Message[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(input.limit, 1), 100)

    // Measured behaviour (probe in RESULTS.md): from_message_id = 0 does not
    // trigger a server fetch — it only returns the locally cached last message.
    // A real page needs an existing message id as anchor, so the first page
    // anchors on chat.last_message.
    let anchor = input.fromMessageId
    if (anchor === undefined) {
      const chat = await this.invoke({ _: 'getChat', chat_id: input.chatId })
      const lastId: number | undefined = chat.last_message?.id
      if (!lastId) {
        // The whole conversation renders empty when this happens, and the
        // renderer caches the empty page, so it never retries — log which half
        // of the chain produced it.
        this.logger.warn(
          `history: chat ${input.chatId} has no last_message (${
            chat.last_message === null ? 'null' : typeof chat.last_message
          }) — returning an empty first page`,
        )
        return { messages: [], hasMore: false }
      }
      anchor = lastId
    }

    const collected: TdObject[] = []
    const seen = new Set<number>()
    let cursor: number = anchor
    // The first page may include its anchor; every later round is strictly older.
    let below = input.fromMessageId
    let exhausted = false
    // A short answer is topped up over a few rounds; bounded so a slow link
    // cannot stall the first paint.
    const MAX_ROUNDS = 3

    for (let round = 0; round < MAX_ROUNDS && collected.length < limit; round += 1) {
      const response = await this.invoke({
        _: 'getChatHistory',
        chat_id: input.chatId,
        from_message_id: cursor,
        offset: 0,
        limit: limit - collected.length,
        only_local: false,
      })
      const rawMessages: TdObject[] = Array.isArray(response.messages) ? response.messages : []
      const fresh = rawMessages.filter((raw) => {
        const id = Number(raw.id)
        if (!Number.isFinite(id) || seen.has(id)) return false
        return below === undefined || id < below
      })
      if (fresh.length === 0) {
        exhausted = true
        break
      }
      for (const raw of fresh) {
        seen.add(Number(raw.id))
        collected.push(raw)
      }
      const oldest = Math.min(...fresh.map((raw) => Number(raw.id)))
      cursor = oldest
      below = oldest
    }

    // getChatHistory returns newest first; the UI wants ascending order, and a
    // top-up round can overshoot, so keep the newest `limit` of what we have.
    const ordered = [...collected].sort((a, b) => Number(a.id) - Number(b.id))
    const page = ordered.length > limit ? ordered.slice(ordered.length - limit) : ordered
    if (page.length === 0) {
      // Only the *first* page is a problem here: an empty "older" page is the
      // normal end of history. An empty first page renders as a silent blank
      // transcript and gets cached by the renderer.
      this.logger.warn(
        `history: getChatHistory returned nothing for chat ${input.chatId} from ${cursor} (anchor ${
          input.fromMessageId ?? 'last_message'
        }, limit ${limit})`,
      )
    }
    const mapped = await Promise.all(page.map((raw) => this.mapMessage(input.chatId, raw)))
    return { messages: mapped, hasMore: !exhausted && mapped.length > 0 }
  }

  async sendText(input: {
    chatId: number
    text: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    const response = await this.invoke({
      _: 'sendMessage',
      chat_id: input.chatId,
      reply_to:
        input.replyTo === undefined
          ? null
          : { _: 'inputMessageReplyToMessage', message_id: input.replyTo },
      input_message_content: {
        _: 'inputMessageText',
        text: { _: 'formattedText', text: input.text },
        clear_draft: true,
      },
    })
    const message = await this.mapMessage(input.chatId, response)
    return { localId: `td-${message.id}`, message }
  }

  async editText(input: { chatId: number; messageId: number; text: string }): Promise<Message> {
    await this.invoke({
      _: 'editMessageText',
      chat_id: input.chatId,
      message_id: input.messageId,
      input_message_content: {
        _: 'inputMessageText',
        text: { _: 'formattedText', text: input.text },
      },
    })
    const history = await this.history({ chatId: input.chatId, fromMessageId: input.messageId + 1, limit: 1 })
    const updated = history.messages.find((m) => m.id === input.messageId)
    if (!updated) throw new AppError('internal', `Message ${input.messageId} not found after edit`)
    return updated
  }

  async deleteMessages(input: { chatId: number; messageIds: number[]; forBoth: boolean }): Promise<void> {
    await this.invoke({
      _: 'deleteMessages',
      chat_id: input.chatId,
      message_ids: input.messageIds,
      revoke: input.forBoth,
    })
  }

  async forwardMessages(input: {
    fromChatId: number
    messageIds: number[]
    toChatId: number
  }): Promise<void> {
    await this.invoke({
      _: 'forwardMessages',
      chat_id: input.toChatId,
      from_chat_id: input.fromChatId,
      message_ids: input.messageIds,
      options: null,
    })
  }

  async markRead(input: { chatId: number; upToMessageId: number }): Promise<void> {
    await this.invoke({
      _: 'viewMessages',
      chat_id: input.chatId,
      message_ids: [input.upToMessageId],
      force_read: true,
    })
  }

  async searchGlobal(input: { q: string; limit: number }): Promise<ChatSummary[]> {
    const response = await this.invoke({ _: 'searchChats', query: input.q, limit: input.limit })
    const ids: number[] = Array.isArray(response.chat_ids) ? response.chat_ids : []
    return Promise.all(ids.map((id) => this.fetchChatSummary(id)))
  }

  async searchInChat(input: {
    chatId: number
    q: string
    fromMessageId?: number
  }): Promise<Message[]> {
    const response = await this.invoke({
      _: 'searchChatMessages',
      chat_id: input.chatId,
      query: input.q,
      sender_id: null,
      from_message_id: input.fromMessageId ?? 0,
      offset: 0,
      limit: 50,
      filter: { _: 'searchMessagesFilterEmpty' },
    })
    const rawMessages: TdObject[] = Array.isArray(response.messages) ? response.messages : []
    return Promise.all(rawMessages.map((raw) => this.mapMessage(input.chatId, raw)))
  }

  /**
   * Downloads a file raw, without announcing it. Attachments go through
   * `downloadFile()` below (which emits `evt:file` for the progress UI); avatars
   * use this one so a hundred preview pictures do not flood the store.
   */
  private async fetchFilePath(
    fileId: number,
    priority: number,
  ): Promise<{ path: string; file: TdObject }> {
    const file = await this.invoke({
      _: 'downloadFile',
      file_id: fileId,
      priority,
      offset: 0,
      limit: 0,
      synchronous: true,
    })
    const path: string | undefined = file?.local?.path
    if (!path) throw new AppError('internal', `File ${fileId} downloaded but path is empty`)
    return { path, file }
  }

  async downloadFile(input: { fileId: number; priority: number }): Promise<{ path: string; url: string }> {
    const { path, file } = await this.fetchFilePath(input.fileId, input.priority)
    const url = registerMediaFile(path)
    this.emit({
      type: 'file',
      fileId: input.fileId,
      downloaded: file?.local?.downloaded_size ?? 0,
      total: file?.expected_size ?? file?.size ?? 0,
      url,
      completed: true,
    })
    return { path, url }
  }

  /**
   * Sends a local file. Photos go through `inputMessagePhoto` so the server builds
   * the usual size ladder; everything else is a document. The pixel size must be
   * known before a photo can be sent (TDLib wants it), so an unparsable image falls
   * back to a document instead of producing a broken bubble.
   */
  async sendMedia(input: {
    chatId: number
    filePath: string
    kind: MediaKind
    caption?: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    const size = input.kind === 'photo' ? await probeImageSize(input.filePath) : null
    const content =
      input.kind === 'photo' && size
        ? {
            _: 'inputMessagePhoto',
            photo: {
              _: 'inputPhoto',
              photo: { _: 'inputFileLocal', path: input.filePath },
              thumbnail: null,
              video: null,
              added_sticker_file_ids: [],
              width: size.width,
              height: size.height,
            },
            caption: formattedText(input.caption),
            show_caption_above_media: false,
            self_destruct_type: null,
            has_spoiler: false,
          }
        : {
            _: 'inputMessageDocument',
            document: {
              _: 'inputDocument',
              document: { _: 'inputFileLocal', path: input.filePath },
              thumbnail: null,
              disable_content_type_detection: false,
            },
            caption: formattedText(input.caption),
          }

    const response = await this.invoke({
      _: 'sendMessage',
      chat_id: input.chatId,
      reply_to: replyTo(input.replyTo),
      options: null,
      input_message_content: content,
    })
    const message = await this.mapMessage(input.chatId, response)
    return { localId: `td-${message.id}`, message }
  }

  /** Sends an existing sticker by file id, as the picker does (design doc §9.4). */
  async sendSticker(input: {
    chatId: number
    fileId: number
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    // Dimensions were cached when the set was mapped; 512 is the sticker default.
    const size = this.stickerSizes.get(input.fileId) ?? { width: 512, height: 512 }
    const response = await this.invoke({
      _: 'sendMessage',
      chat_id: input.chatId,
      reply_to: replyTo(input.replyTo),
      options: null,
      input_message_content: {
        _: 'inputMessageSticker',
        sticker: {
          _: 'inputSticker',
          sticker: { _: 'inputFileId', id: input.fileId },
          thumbnail: null,
          width: size.width,
          height: size.height,
        },
        emoji: '',
      },
    })
    const message = await this.mapMessage(input.chatId, response)
    return { localId: `td-${message.id}`, message }
  }

  async listStickerSets(): Promise<StickerSetSummary[]> {
    const response = await this.invoke({
      _: 'getInstalledStickerSets',
      sticker_type: { _: 'stickerTypeRegular' },
    })
    const sets: TdObject[] = Array.isArray(response?.sets) ? response.sets : []
    return sets.map((set) => ({
      id: String(set.id),
      title: set.title ?? '',
      ...(set.thumbnail ? { thumbnail: mapStickerThumbnail(set.thumbnail) } : {}),
    }))
  }

  async getStickerSet(setId: string): Promise<StickerSet> {
    const response = await this.invoke({ _: 'getStickerSet', set_id: setId })
    const stickers: TdObject[] = Array.isArray(response?.stickers) ? response.stickers : []
    return {
      id: String(response.id),
      title: response.title ?? '',
      ...(response.thumbnail ? { thumbnail: mapStickerThumbnail(response.thumbnail) } : {}),
      stickers: stickers.map((sticker) => this.toSticker(sticker)).filter((item) => item.fileId > 0),
    }
  }

  private toSticker(raw: TdObject): Sticker {
    const fileId: number = raw?.sticker?.id ?? 0
    if (fileId && raw?.width && raw?.height) {
      this.stickerSizes.set(fileId, { width: raw.width, height: raw.height })
    }
    return {
      fileId,
      format: mapStickerFormat(raw?.format?._) ?? 'webp',
      ...(raw?.emoji ? { emoji: raw.emoji } : {}),
      ...(raw?.width ? { width: raw.width } : {}),
      ...(raw?.height ? { height: raw.height } : {}),
      ...(raw?.thumbnail?.file?.id ? { thumbFileId: raw.thumbnail.file.id } : {}),
    }
  }

  async setProxy(config: ProxyConfig | null): Promise<void> {
    try {
      await this.applyProxy(config)
    } catch (error) {
      throw toAdapterError(error, 'Failed to apply proxy')
    }
  }

  /**
   * Enables the candidate proxy, waits for a real connection to come up, then
   * restores the previous configuration. Never silently reports success.
   */
  async testProxy(config: ProxyConfig): Promise<ProxyTestResult> {
    const previous = this.proxy
    const startedAt = Date.now()
    try {
      await this.applyProxy(config)
      await this.waitForOnline(8_000)
      return { ok: true, latencyMs: Date.now() - startedAt }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      await this.applyProxy(previous).catch(() => undefined)
    }
  }

  /** Applies a proxy; may be called before authorization (TDLib allows that). */
  private async applyProxy(config: ProxyConfig | null): Promise<void> {
    if (!config) {
      await this.invoke({ _: 'disableProxy' }).catch(() => undefined)
      this.proxy = null
      return
    }

    const type =
      config.type === 'socks5'
        ? {
            _: 'proxyTypeSocks5',
            username: config.username ?? '',
            password: config.password ?? '',
          }
        : { _: 'proxyTypeMtproto', secret: normalizeMtprotoSecret(config.secret ?? '') }

    await this.invoke({
      _: 'addProxy',
      proxy: { _: 'proxy', server: config.host, port: config.port, type },
      enable: true,
      comment: 'WechatGram',
    })
    this.proxy = config
    this.logger.info(`proxy enabled: ${config.type} ${config.host}:${config.port}`)
  }

  private async waitForOnline(timeoutMs: number): Promise<void> {
    if (this.isOnline()) return
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (this.isOnline()) return
    }
    throw new AppError(
      'proxy_failed',
      'Proxy did not reach an online connection within 8 seconds — check host, port and secret',
    )
  }

  private isOnline(): boolean {
    return this.connection === 'online'
  }

  /** `getVersion()` throws until the first TDLib update arrives. */
  private safeVersion(): string {
    try {
      return this.client?.getVersion() ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  private async handleUpdate(update: TdObject): Promise<void> {
    switch (update._) {
      case 'updateAuthorizationState':
        await this.handleAuthorizationState(update.authorization_state)
        return
      case 'updateConnectionState':
        this.setConnection(mapConnectionState(update.state))
        return
      case 'updateNewMessage': {
        const raw = update.message
        if (!raw) return
        const message = await this.mapMessage(raw.chat_id, raw)
        this.emit({ type: 'messages', chatId: raw.chat_id, ops: [{ op: 'new', message }] })
        await this.emitChatUpsert(raw.chat_id)
        return
      }
      case 'updateMessageContent':
      case 'updateMessageEdited': {
        // Remap the whole message instead of patching the text: an edit can change
        // media and a media upload completion can change a caption (§6.1).
        const chatId: number = update.chat_id
        const messageId: number = update.message_id
        try {
          const raw = await this.invoke({
            _: 'getMessage',
            chat_id: chatId,
            message_id: messageId,
          })
          if (!raw || raw._ === 'error') return
          const message = await this.mapMessage(chatId, raw)
          this.emit({ type: 'messages', chatId, ops: [{ op: 'replace', message }] })
        } catch {
          // The message may have been deleted in the same batch.
        }
        return
      }
      case 'updateDeleteMessages':
        this.emit({
          type: 'messages',
          chatId: update.chat_id,
          ops: [{ op: 'delete', chatId: update.chat_id, messageIds: update.message_ids ?? [] }],
        })
        return
      case 'updateChatReadInbox':
        this.emit({
          type: 'messages',
          chatId: update.chat_id,
          ops: [
            {
              op: 'read',
              chatId: update.chat_id,
              upToMessageId: update.last_read_inbox_message_id ?? 0,
            },
          ],
        })
        await this.emitChatUpsert(update.chat_id)
        return
      case 'updateChatReadOutbox':
        // Read receipts for our own messages: last_read_outbox_message_id moves.
        await this.emitChatUpsert(update.chat_id)
        return
      case 'updateChatPosition':
      case 'updateNewChat':
        await this.emitChatUpsert(update.chat?.id ?? update.chat_id)
        return
      case 'updateChatTitle':
        if (typeof update.title === 'string') this.chatTitles.set(update.chat_id, update.title)
        await this.emitChatUpsert(update.chat_id)
        return
      case 'updateChatPhoto': {
        // A new photo replaces the old one; drop the cache and refetch.
        const chatId: number = update.chat_id
        this.chatAvatarFiles.delete(chatId)
        this.chatAvatarUrls.delete(chatId)
        this.chatAvatarMisses.delete(chatId)
        void this.prefetchChatAvatars([chatId])
        return
      }
      case 'updateUser': {
        // Our own profile changed (new photo): refresh the rail avatar.
        const user = update.user
        if (!user || user.id !== this.selfUserId) return
        const fileId: number | undefined = user.profile_photo?.small?.id ?? user.profile_photo?.big?.id
        if (fileId) void this.loadSelfAvatar(fileId)
        return
      }
      case 'updateChatAction':
        this.emit({
          type: 'typing',
          chatId: update.chat_id,
          userId: update.sender_id?.user_id ?? 0,
          action: update.action?._ ?? 'typing',
          until:
            update.action?._ === 'chatActionCancel' || update.action?._ === 'chatActionTypingCancel'
              ? Date.now()
              : Date.now() + 5_000,
        })
        return
      case 'updateFile': {
        const file = update.file
        if (!file) return
        const local = file.local ?? {}
        const completed = Boolean(local.is_downloading_completed)
        const uploading = Boolean(file.remote?.is_uploading_active)
        this.emit({
          type: 'file',
          fileId: file.id,
          downloaded: uploading
            ? (file.remote?.uploaded_size ?? 0)
            : (local.downloaded_size ?? 0),
          total: file.expected_size ?? file.size ?? 0,
          ...(completed && local.path ? { url: registerMediaFile(local.path) } : {}),
          ...(uploading ? { uploading: true } : {}),
          ...(completed || file.remote?.is_uploading_completed ? { completed: true } : {}),
        })
        return
      }
      default:
        return
    }
  }

  private async handleAuthorizationState(state: TdObject | undefined): Promise<void> {
    switch (state?._) {
      case 'authorizationStateWaitPhoneNumber':
        this.setAuth({ kind: 'waitPhoneNumber' })
        this.logger.info(`TDLib ${this.safeVersion()} ready for phone login`)
        return
      case 'authorizationStateWaitCode': {
        const info = state.code_info ?? {}
        const codeLength: number | undefined = info.type?.code_length
        this.setAuth({
          kind: 'waitCode',
          ...(typeof info.phone_number === 'string' ? { hint: `sent to ${info.phone_number}` } : {}),
          ...(typeof codeLength === 'number' ? { codeLength } : {}),
        })
        return
      }
      case 'authorizationStateWaitPassword':
        this.setAuth({
          kind: 'waitPassword',
          ...(typeof state.password_hint === 'string' && state.password_hint
            ? { hint: state.password_hint }
            : {}),
        })
        return
      case 'authorizationStateReady': {
        this.setConnection('online')
        this.logger.info(`TDLib ${this.safeVersion()} authorized, loading self`)
        const me = await this.me()
        this.setAuth({ kind: 'ready', me })
        return
      }
      case 'authorizationStateClosed':
        this.setAuth({ kind: 'closed' })
        return
      default:
        // authorizationStateLoggingOut / waitOtherDeviceConfirmation etc. keep
        // the previous state visible; nothing actionable for the UI in W1.
        return
    }
  }

  private async emitChatUpsert(chatId: number | undefined): Promise<void> {
    if (typeof chatId !== 'number') return
    try {
      const chat = await this.fetchChatSummary(chatId)
      this.emit({ type: 'chats', ops: [{ op: 'upsert', chat }] })
      // New or updated chat: its photo may not be downloaded yet.
      void this.prefetchChatAvatars([chatId])
    } catch {
      // Chat may have been deleted between update and fetch.
    }
  }

  private async fetchChatSummary(chatId: number): Promise<ChatSummary> {
    const chat = await this.invoke({ _: 'getChat', chat_id: chatId })
    return this.mapChat(chat)
  }

  private mapChat(chat: TdObject): ChatSummary {
    const positions: TdObject[] = Array.isArray(chat.positions) ? chat.positions : []
    const mainPosition = positions.find((position) => position.list?._ === 'chatListMain')
    const lastMessage = chat.last_message
    if (typeof chat.title === 'string') this.chatTitles.set(chat.id, chat.title)
    const avatarUrl = this.chatAvatarUrls.get(chat.id)
    return {
      id: chat.id,
      title: chat.title ?? '',
      kind: mapChatKind(chat.type),
      unread: chat.unread_count ?? 0,
      pinned: Boolean(mainPosition?.is_pinned),
      muted: Boolean(chat.notification_settings?.is_muted),
      lastReadInboxMessageId: Number(chat.last_read_inbox_message_id ?? 0),
      lastReadOutboxMessageId: Number(chat.last_read_outbox_message_id ?? 0),
      ...(lastMessage ? { lastMessageText: previewContent(lastMessage.content) } : {}),
      ...(lastMessage ? { lastMessageAt: Number(lastMessage.date) } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    }
  }

  private async mapMessage(chatId: number, raw: TdObject): Promise<Message> {
    // `sender_id` is either `messageSenderUser { user_id }` or
    // `messageSenderChat { chat_id }` — channel posts and anonymous admins use
    // the latter. Reading only `user_id` used to leave those as `未知`.
    const senderUserId: number = raw.sender_id?.user_id ?? 0
    const senderChatId: number = raw.sender_id?.chat_id ?? 0
    const senderName = senderUserId
      ? await this.resolveUserName(senderUserId)
      : senderChatId
        ? await this.resolveChatTitle(senderChatId)
        : '未知'
    const content = raw.content ?? {}
    const mapped = mapContent(content)
    let text = mapped.text
    if (mapped.kind === 'service' && text === '') {
      text = SERVICE_CONTENT_TYPES.has(content._)
        ? await serviceText(content, {
            senderName,
            outgoing: Boolean(raw.is_outgoing),
            resolveUserName: (userId: number) => this.resolveUserName(userId),
          })
        : '[暂不支持的消息]'
    }

    return {
      id: raw.id,
      chatId,
      senderId: senderUserId,
      ...(senderChatId ? { senderChatId } : {}),
      senderName,
      outgoing: Boolean(raw.is_outgoing),
      date: Number(raw.date),
      kind: mapped.kind,
      text,
      ...(mapped.entities.length ? { entities: mapped.entities } : {}),
      ...(mapped.media ? { media: mapped.media } : {}),
      ...(raw.reply_to?.message_id ? { replyToId: raw.reply_to.message_id } : {}),
      ...(raw.edit_date ? { edited: true } : {}),
    }
  }

  private async resolveUserName(userId: number): Promise<string> {
    const cached = this.userNames.get(userId)
    if (cached) return cached
    try {
      const user = await this.invoke({ _: 'getUser', user_id: userId })
      const name = this.mapUser(user)
      const label = [name.firstName, name.lastName].filter(Boolean).join(' ') || name.username || '未知'
      this.userNames.set(userId, label)
      return label
    } catch {
      return '未知'
    }
  }

  private async resolveChatTitle(chatId: number): Promise<string> {
    const cached = this.chatTitles.get(chatId)
    if (cached) return cached
    try {
      const chat = await this.invoke({ _: 'getChat', chat_id: chatId })
      const title: string = chat?.title ?? ''
      if (title) this.chatTitles.set(chatId, title)
      return title || '未知'
    } catch {
      return '未知'
    }
  }

  private mapUser(user: TdObject): Self {
    const username: string | undefined = user.usernames?.active_usernames?.[0]
    return {
      id: user.id,
      firstName: user.first_name ?? '',
      ...(user.last_name ? { lastName: user.last_name } : {}),
      ...(username ? { username } : {}),
      ...(user.phone_number ? { phone: user.phone_number } : {}),
    }
  }

  private async invoke(method: TdObject): Promise<any> {
    const client = this.client
    if (!client) throw new AppError('internal', 'TDLib client is not started')
    try {
      return await client.invoke(method)
    } catch (error) {
      throw toAdapterError(error, `TDLib call ${String(method._)} failed`)
    }
  }

  private setAuth(state: AuthState): void {
    this.auth = state
    this.emit({ type: 'auth', state })
  }

  private setConnection(state: ConnectionState): void {
    if (this.connection === state) return
    this.connection = state
    this.emit({ type: 'connection', state })
  }
}

function mapConnectionState(state: TdObject | undefined): ConnectionState {
  switch (state?._) {
    case 'connectionStateReady':
      return 'online'
    case 'connectionStateUpdating':
      return 'updating'
    case 'connectionStateConnecting':
    case 'connectionStateConnectingToProxy':
      return 'connecting'
    default:
      return 'offline'
  }
}

function mapChatKind(type: TdObject | undefined): ChatSummary['kind'] {
  switch (type?._) {
    case 'chatTypePrivate':
      return 'private'
    case 'chatTypeSecret':
      return 'private'
    case 'chatTypeSupergroup':
      return type.is_channel ? 'channel' : 'group'
    default:
      return 'group'
  }
}

function normalizeMtprotoSecret(secret: string): string {
  const cleaned = secret.trim().replace(/^https?:\/\/t\.me\/proxy\?.*secret=/, '').replace(/\s/g, '')
  return cleaned
}

function replyTo(messageId?: number): TdObject | null {
  return messageId === undefined
    ? null
    : { _: 'inputMessageReplyToMessage', message_id: messageId }
}

function formattedText(text: string | undefined): TdObject {
  return { _: 'formattedText', text: text ?? '', entities: [] }
}

function servicePreview(content: TdObject): string {
  switch (content._) {
    case 'messageBasicGroupChatCreate':
    case 'messageSupergroupChatCreate':
      return '创建群聊'
    case 'messageChatChangeTitle':
      return '修改群聊名称'
    case 'messageChatChangePhoto':
      return '修改群聊头像'
    case 'messageChatDeletePhoto':
      return '移除群聊头像'
    case 'messageChatAddMembers':
    case 'messageChatJoinByLink':
    case 'messageChatJoinByRequest':
      return '加入群聊'
    case 'messageChatDeleteMember':
      return '退出群聊'
    case 'messagePinMessage':
      return '置顶了一条消息'
    case 'messageScreenshotTaken':
      return '对聊天进行了截图'
    case 'messageContactRegistered':
      return '加入了 Telegram'
    case 'messageCustomServiceAction':
      return typeof content.text === 'string' ? content.text : ''
    default:
      return ''
  }
}

function previewContent(content: TdObject | undefined): string {
  if (!content) return ''
  return extractText(content) ?? (mapContentLabel(content) || servicePreview(content))
}

function mapContentLabel(content: TdObject | undefined): string {
  switch (content?._) {
    case 'messagePhoto':
      return '[图片]'
    case 'messageVideo':
      return '[视频]'
    case 'messageSticker':
      return '[贴纸]'
    case 'messageVoiceNote':
      return '[语音]'
    case 'messageDocument':
      return '[文件]'
    case 'messagePoll':
      return '[投票]'
    default:
      return ''
  }
}

function extractText(content: TdObject | undefined): string | undefined {
  const formatted = content?.text ?? content?.caption
  if (formatted && typeof formatted.text === 'string') return formatted.text
  return undefined
}

/** TDLib content types that are service messages (centered transcript notices). */
const SERVICE_CONTENT_TYPES = new Set([
  'messageBasicGroupChatCreate',
  'messageSupergroupChatCreate',
  'messageChatUpgradeFrom',
  'messageChatUpgradeTo',
  'messageChatChangeTitle',
  'messageChatChangePhoto',
  'messageChatDeletePhoto',
  'messageChatAddMembers',
  'messageChatJoinByLink',
  'messageChatJoinByRequest',
  'messageChatDeleteMember',
  'messagePinMessage',
  'messageScreenshotTaken',
  'messageChatSetBackground',
  'messageChatSetTheme',
  'messageChatSetTtl',
  'messageChatSetMessageAutoDeleteTime',
  'messageForumTopicCreated',
  'messageForumTopicEdited',
  'messageForumTopicIsClosedToggled',
  'messageForumTopicIsHiddenToggled',
  'messageContactRegistered',
  'messageSuggestProfilePhoto',
  'messageCustomServiceAction',
])

interface ServiceTextContext {
  senderName: string
  outgoing: boolean
  resolveUserName: (userId: number) => Promise<string>
}

/**
 * Human-readable text for a TDLib service message. TDLib itself ships no text
 * for these — the client must compose it (WeChat-style, Chinese).
 */
async function serviceText(content: TdObject, ctx: ServiceTextContext): Promise<string> {
  const who = ctx.outgoing ? '你' : ctx.senderName
  const title = (value: unknown): string => (typeof value === 'string' && value ? value : '')
  switch (content._) {
    case 'messageBasicGroupChatCreate':
    case 'messageSupergroupChatCreate': {
      const name = title(content.title)
      return name ? `${who}创建了群聊「${name}」` : `${who}创建了群聊`
    }
    case 'messageChatUpgradeFrom':
    case 'messageChatUpgradeTo':
      return '群聊已升级为超级群组'
    case 'messageChatChangeTitle': {
      const name = title(content.title)
      return name ? `${who}修改群聊名称为「${name}」` : `${who}修改了群聊名称`
    }
    case 'messageChatChangePhoto':
      return `${who}修改了群聊头像`
    case 'messageChatDeletePhoto':
      return `${who}移除了群聊头像`
    case 'messageChatAddMembers': {
      const ids: number[] = Array.isArray(content.member_user_ids) ? content.member_user_ids : []
      const names = await Promise.all(ids.map((id) => ctx.resolveUserName(Number(id))))
      if (names.length === 0) return `${who}邀请了新成员加入群聊`
      return `${who}邀请${names.join('、')}加入了群聊`
    }
    case 'messageChatJoinByLink':
      return `${who}通过邀请链接加入了群聊`
    case 'messageChatJoinByRequest':
      return `${who}加入了群聊`
    case 'messageChatDeleteMember': {
      // The deleted member is the subject, not necessarily the sender.
      const name = await ctx.resolveUserName(Number(content.user_id))
      return `${name}退出了群聊`
    }
    case 'messagePinMessage':
      return `${who}置顶了一条消息`
    case 'messageScreenshotTaken':
      return `${who}对聊天进行了截图`
    case 'messageChatSetBackground':
      return `${who}修改了聊天背景`
    case 'messageChatSetTheme':
      return `${who}修改了聊天主题`
    case 'messageChatSetTtl':
      return `${who}修改了消息自动删除定时`
    case 'messageChatSetMessageAutoDeleteTime':
      return Number(content.message_auto_delete_time) > 0
        ? `${who}开启了消息自动删除`
        : `${who}关闭了消息自动删除`
    case 'messageForumTopicCreated': {
      const name = title(content.name)
      return name ? `${who}创建了话题「${name}」` : `${who}创建了话题`
    }
    case 'messageForumTopicEdited':
      return `${who}编辑了话题`
    case 'messageForumTopicIsClosedToggled':
      return content.is_closed ? `${who}关闭了话题` : `${who}重新打开了话题`
    case 'messageForumTopicIsHiddenToggled':
      return content.is_hidden ? `${who}隐藏了话题` : `${who}显示了话题`
    case 'messageContactRegistered':
      return `${who}加入了 Telegram`
    case 'messageSuggestProfilePhoto':
      return `${who}建议你使用新的头像`
    case 'messageCustomServiceAction':
      return typeof content.text === 'string' ? content.text : ''
    default:
      return ''
  }
}

function mapContent(content: TdObject): {
  kind: Message['kind']
  text: string
  entities: MessageEntity[]
  media?: Message['media']
} {
  switch (content._) {
    case 'messageText': {
      const formatted = content.text ?? {}
      return {
        kind: 'text',
        text: formatted.text ?? '',
        entities: mapEntities(formatted.entities),
      }
    }
    case 'messagePhoto': {
      const photo = content.photo ?? {}
      const sizes: TdObject[] = Array.isArray(photo.sizes) ? photo.sizes : []
      const display = pickLargest(sizes)
      // A small variant doubles as the bubble placeholder until the full file lands.
      const thumb = pickSmallestAtLeast(sizes, 160) ?? pickLargest(sizes)
      return {
        kind: 'photo',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: {
          fileId: display?.photo?.id ?? 0,
          ...(thumb && thumb !== display ? { thumbFileId: thumb.photo?.id } : {}),
          ...(display?.width ? { width: display.width } : {}),
          ...(display?.height ? { height: display.height } : {}),
          ...(photo.minithumbnail?.data ? { minithumbnail: photo.minithumbnail.data } : {}),
          ...mediaUrls(display?.photo, thumb?.photo),
        },
      }
    }
    case 'messageVideo': {
      const video = content.video ?? {}
      return {
        kind: 'video',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: {
          fileId: video.video?.id ?? 0,
          ...(video.thumbnail?.file?.id ? { thumbFileId: video.thumbnail.file.id } : {}),
          ...(video.duration ? { duration: video.duration } : {}),
          ...(video.width ? { width: video.width } : {}),
          ...(video.height ? { height: video.height } : {}),
          ...(video.file_name ? { fileName: video.file_name } : {}),
          ...(video.mime_type ? { mimeType: video.mime_type } : {}),
          ...(video.minithumbnail?.data ? { minithumbnail: video.minithumbnail.data } : {}),
          ...mediaUrls(video.video, video.thumbnail?.file),
        },
      }
    }
    case 'messageAnimation': {
      // GIF-style messages are videos to us: Chromium plays the MP4 natively.
      const animation = content.animation ?? {}
      return {
        kind: 'video',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: {
          fileId: animation.animation?.id ?? 0,
          ...(animation.thumbnail?.file?.id ? { thumbFileId: animation.thumbnail.file.id } : {}),
          ...(animation.duration ? { duration: animation.duration } : {}),
          ...(animation.width ? { width: animation.width } : {}),
          ...(animation.height ? { height: animation.height } : {}),
          ...(animation.file_name ? { fileName: animation.file_name } : {}),
          ...(animation.mime_type ? { mimeType: animation.mime_type } : {}),
          ...mediaUrls(animation.animation, animation.thumbnail?.file),
        },
      }
    }
    case 'messageDocument': {
      const document = content.document ?? {}
      return {
        kind: 'file',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: {
          fileId: document.document?.id ?? 0,
          ...(document.thumbnail?.file?.id ? { thumbFileId: document.thumbnail.file.id } : {}),
          ...(document.file_name ? { fileName: document.file_name } : {}),
          ...(document.document?.size ? { size: document.document.size } : {}),
          ...(document.mime_type ? { mimeType: document.mime_type } : {}),
          ...(document.minithumbnail?.data ? { minithumbnail: document.minithumbnail.data } : {}),
          ...mediaUrls(document.document, document.thumbnail?.file),
        },
      }
    }
    case 'messageSticker': {
      const sticker = content.sticker ?? {}
      return {
        kind: 'sticker',
        text: '',
        entities: [],
        media: {
          fileId: sticker.sticker?.id ?? 0,
          ...(sticker.thumbnail?.file?.id ? { thumbFileId: sticker.thumbnail.file.id } : {}),
          stickerFormat: mapStickerFormat(sticker.format?._),
          ...(sticker.emoji ? { stickerEmoji: sticker.emoji } : {}),
          ...(sticker.width ? { width: sticker.width } : {}),
          ...(sticker.height ? { height: sticker.height } : {}),
          ...mediaUrls(sticker.sticker, sticker.thumbnail?.file),
        },
      }
    }
    case 'messageVoiceNote': {
      const voice = content.voice_note ?? {}
      return {
        kind: 'voice',
        text: content.caption?.text ?? '',
        entities: [],
        media: {
          fileId: voice.voice?.id ?? 0,
          mimeType: voice.mime_type ?? 'audio/ogg',
          ...(voice.duration ? { duration: voice.duration } : {}),
          ...mediaUrls(voice.voice),
        },
      }
    }
    case 'messagePoll':
      return { kind: 'poll', text: content.poll?.question?.text ?? '', entities: [] }
    // Telegram's animated emoji: a message that is a single (usually animated)
    // emoji. Keep the glyph and let the renderer size it like WeChat big emoji.
    case 'messageAnimatedEmoji':
      return { kind: 'text', text: typeof content.emoji === 'string' ? content.emoji : '', entities: [] }
    // Dice / basketball etc. carry their emoji; the thrown value is a TDLib
    // update, not part of the message, so we show the emoji itself.
    case 'messageDice':
      return { kind: 'text', text: typeof content.emoji === 'string' ? content.emoji : '', entities: [] }
    default:
      return { kind: 'service', text: '', entities: [] }
  }
}

/** Local URLs for an already-downloaded file (and optional thumbnail). */
function mediaUrls(
  file: TdObject | undefined,
  thumb?: TdObject | undefined,
): { localUrl?: string; thumbUrl?: string } {
  const localUrl = localUrlOf(file)
  const thumbUrl = localUrlOf(thumb)
  return {
    ...(localUrl ? { localUrl } : {}),
    ...(thumbUrl ? { thumbUrl } : {}),
  }
}

function localUrlOf(file: TdObject | undefined): string | undefined {
  const local = file?.local
  if (!local?.is_downloading_completed) return undefined
  if (typeof local.path !== 'string' || local.path.length === 0) return undefined
  return registerMediaFile(local.path)
}

function pickLargest(sizes: TdObject[]): TdObject | undefined {
  return sizes.reduce<TdObject | undefined>((best, size) => {
    if (!best) return size
    const area = (size.width ?? 0) * (size.height ?? 0)
    const bestArea = (best.width ?? 0) * (best.height ?? 0)
    return area > bestArea ? size : best
  }, undefined)
}

function pickSmallestAtLeast(sizes: TdObject[], minWidth: number): TdObject | undefined {
  return [...sizes]
    .filter((size) => (size.width ?? 0) >= minWidth)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0]
}

/** Set covers are thumbnails, not stickers, but they render through the same path. */
function mapStickerThumbnail(thumbnail: TdObject): Sticker {
  const format: string | undefined = thumbnail?.format?._
  return {
    fileId: thumbnail?.file?.id ?? 0,
    format: format === 'thumbnailFormatTgs' ? 'tgs' : format === 'thumbnailFormatWebm' ? 'webm' : 'webp',
    ...(thumbnail?.width ? { width: thumbnail.width } : {}),
    ...(thumbnail?.height ? { height: thumbnail.height } : {}),
  }
}

function mapStickerFormat(format: string | undefined): 'webp' | 'tgs' | 'webm' | undefined {
  switch (format) {
    case 'stickerFormatWebp':
      return 'webp'
    case 'stickerFormatTgs':
      return 'tgs'
    case 'stickerFormatWebm':
      return 'webm'
    default:
      return undefined
  }
}

function mapEntities(rawEntities: TdObject[] | undefined): MessageEntity[] {
  if (!Array.isArray(rawEntities)) return []
  const result: MessageEntity[] = []
  for (const raw of rawEntities) {
    const type = ENTITY_TYPES[raw?.type?._]
    if (!type) continue
    result.push({
      type,
      offset: raw.offset ?? 0,
      length: raw.length ?? 0,
      ...(raw.url ? { url: raw.url } : {}),
      ...(raw.language ? { language: raw.language } : {}),
      ...(raw.type?.custom_emoji_id ? { customEmojiId: raw.type.custom_emoji_id } : {}),
    })
  }
  return result
}

