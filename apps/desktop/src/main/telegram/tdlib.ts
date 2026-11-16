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
} from '@wechatgram/protocol'
import { getTdjson } from 'prebuilt-tdlib'
import { configure, createClient } from 'tdl'

import { createLogger, toAdapterError } from '../util'
import { AdapterEmitter, type TelegramAdapter } from './adapter'

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
    return this.mapUser(raw)
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
    return Promise.all(page.map((id) => this.fetchChatSummary(id)))
  }

  async getChat(chatId: number): Promise<ChatSummary> {
    return this.fetchChatSummary(chatId)
  }

  async openChat(chatId: number): Promise<void> {
    const history = await this.history({ chatId, limit: 1 })
    const latest = history.messages.at(-1)
    if (latest) await this.markRead({ chatId, upToMessageId: latest.id })
  }

  async history(input: {
    chatId: number
    fromMessageId?: number
    limit: number
  }): Promise<{ messages: Message[]; hasMore: boolean }> {
    const limit = Math.min(input.limit, 100)

    // Measured behaviour (probe in RESULTS.md): from_message_id = 0 does not
    // trigger a server fetch — it only returns the locally cached last message.
    // A real page needs an existing message id as anchor, so the first page
    // anchors on chat.last_message.
    let anchor = input.fromMessageId
    if (anchor === undefined) {
      const chat = await this.invoke({ _: 'getChat', chat_id: input.chatId })
      const lastId: number | undefined = chat.last_message?.id
      if (!lastId) return { messages: [], hasMore: false }
      anchor = lastId
    }

    const response = await this.invoke({
      _: 'getChatHistory',
      chat_id: input.chatId,
      from_message_id: anchor,
      offset: 0,
      limit,
      only_local: false,
    })
    const rawMessages: TdObject[] = Array.isArray(response.messages) ? response.messages : []
    // TDLib includes the anchor message itself; paging must be strictly older.
    const page =
      input.fromMessageId === undefined
        ? rawMessages
        : rawMessages.filter((raw) => Number(raw.id) < input.fromMessageId!)
    const mapped = await Promise.all(page.map((raw) => this.mapMessage(input.chatId, raw)))
    // getChatHistory returns newest first; the UI wants ascending order.
    return { messages: mapped.reverse(), hasMore: rawMessages.length >= limit }
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

  async downloadFile(input: { fileId: number; priority: number }): Promise<{ path: string }> {
    const file = await this.invoke({
      _: 'downloadFile',
      file_id: input.fileId,
      priority: input.priority,
      offset: 0,
      limit: 0,
      synchronous: true,
    })
    const path: string | undefined = file?.local?.path
    if (!path) throw new AppError('internal', `File ${input.fileId} downloaded but path is empty`)
    return { path }
  }

  async uploadFile(): Promise<{ fileId: number }> {
    throw new AppError('not_implemented', 'File upload lands in W3')
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
      case 'updateMessageContent': {
        const text = extractText(update.new_content)
        this.emit({
          type: 'messages',
          chatId: update.chat_id,
          ops: [
            { op: 'edit', chatId: update.chat_id, messageId: update.message_id, text: text ?? '' },
          ],
        })
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
      case 'updateChatPosition':
      case 'updateNewChat':
        await this.emitChatUpsert(update.chat?.id ?? update.chat_id)
        return
      case 'updateChatTitle':
        if (typeof update.title === 'string') this.chatTitles.set(update.chat_id, update.title)
        await this.emitChatUpsert(update.chat_id)
        return
      case 'updateChatAction':
        this.emit({
          type: 'typing',
          chatId: update.chat_id,
          userId: update.sender_id?.user_id ?? 0,
          action: update.action?._ ?? 'typing',
          until: Date.now() + 5_000,
        })
        return
      case 'updateFile': {
        const file = update.file
        if (!file) return
        this.emit({
          type: 'file',
          fileId: file.id,
          downloaded: file.local?.downloaded_size ?? 0,
          total: file.expected_size ?? file.size ?? 0,
          ...(file.local?.is_downloading_completed ? { path: file.local.path } : {}),
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
    return {
      id: chat.id,
      title: chat.title ?? '',
      kind: mapChatKind(chat.type),
      unread: chat.unread_count ?? 0,
      pinned: Boolean(mainPosition?.is_pinned),
      muted: Boolean(chat.notification_settings?.is_muted),
      ...(lastMessage ? { lastMessageText: previewContent(lastMessage.content) } : {}),
      ...(lastMessage ? { lastMessageAt: Number(lastMessage.date) } : {}),
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
    const { kind, media, text, entities } = mapContent(content)

    return {
      id: raw.id,
      chatId,
      senderId: senderUserId,
      ...(senderChatId ? { senderChatId } : {}),
      senderName,
      outgoing: Boolean(raw.is_outgoing),
      date: Number(raw.date),
      kind,
      text,
      ...(entities.length ? { entities } : {}),
      ...(media ? { media } : {}),
      ...(raw.reply_to?.message_id ? { replyToId: raw.reply_to.message_id } : {}),
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

function previewContent(content: TdObject | undefined): string {
  return extractText(content) ?? mapContentLabel(content)
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
      const sizes: TdObject[] = content.photo?.sizes ?? []
      const biggest = sizes.at(-1)
      return {
        kind: 'photo',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: {
          fileId: biggest?.photo?.id ?? 0,
          ...(biggest?.width ? { width: biggest.width } : {}),
          ...(biggest?.height ? { height: biggest.height } : {}),
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
          ...(video.duration ? { duration: video.duration } : {}),
          ...(video.file_name ? { fileName: video.file_name } : {}),
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
          ...(document.file_name ? { fileName: document.file_name } : {}),
          ...(document.document?.size ? { size: document.document.size } : {}),
          ...(document.mime_type ? { mimeType: document.mime_type } : {}),
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
          stickerFormat: mapStickerFormat(sticker.format?._),
          ...(sticker.width ? { width: sticker.width } : {}),
          ...(sticker.height ? { height: sticker.height } : {}),
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
          ...(voice.duration ? { duration: voice.duration } : {}),
        },
      }
    }
    case 'messagePoll':
      return { kind: 'poll', text: content.poll?.question?.text ?? '', entities: [] }
    default:
      return { kind: 'service', text: '', entities: [] }
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
