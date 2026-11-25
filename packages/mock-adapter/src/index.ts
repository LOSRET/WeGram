import { randomUUID } from 'node:crypto'

import { AppError } from '@wegram/protocol'
import type {
  AuthState,
  BootState,
  ChatSummary,
  ConnectionState,
  Contact,
  CustomEmojiSticker,
  InlineButtonCallback,
  Message,
  MessageProperties,
  NotificationScope,
  NotificationScopes,
  ProxyConfig,
  ProxyTestResult,
  ScopeNotificationSettings,
  SearchMessagesCursor,
  Self,
  StickerSet,
  StickerSetSummary,
  StorageFreed,
  StorageMediaKind,
  StorageUsage,
  InstantView,
} from '@wegram/protocol'

import { AdapterEmitter, type TelegramAdapter } from '@wegram/adapter-contract'
import { MockAssets } from './assets'
import { MockAvatars } from './avatars'
import { createMockBots } from './bots'
import { createMockChats } from './chats'
import { createMockComments } from './comments'
import { createMockTopics } from './topics'
import { listMockContacts } from './contacts'
import { ME, MOCK_CODE, MOCK_PASSWORD, type Fixture } from './constants'
import { createMockEdits } from './edits'
import { createMockSends } from './sends'
import { createMockUsers } from './users'
import { applyRead } from './effects'
import type { MockSendDeps } from './media'
import { beginMockStream, downloadMockFile, mockDownloadedPrefix } from './files'
import { buildFixtures } from './fixtures'
import {
  buildInstantView,
  clearMockStorage,
  initialMockStorage,
  trimMockStorage,
} from '@wegram/mock-fixtures'
import { forwardedOrigin } from '@wegram/mock-session'
import {
  mockHistory,
  mockHistoryAround,
  mockHistoryNewer,
  type MockAroundQuery,
  type MockHistoryQuery,
  type MockNewerQuery,
} from './history'
import { createMockNotifications } from './notifications'
import { createMockPolls } from './polls'
import { mockMessageProperties } from './properties'
import { searchChats, searchMessages, searchMessagesInScope } from './search'
import {
  changeMockStickerSet,
  getMockStickerSet,
  initialMockStickerSetState,
  listMockCustomEmoji,
  listMockStickerSets,
} from './stickers'
import { emitTraffic } from './traffic'

export interface MockAdapterOptions {
  /** Where generated fixture media is written (under userData). */
  mediaDir: string
  /**
   * Mints a `wx-media://` URL for a local file. Injected because the token
   * registry is a main-process concern (`main/media/registry.ts`); this package
   * must not import app code.
   */
  registerMedia: (filePath: string) => string
  /** Reads an image's pixel size, or null for a format we cannot parse. */
  probeImageSize: (filePath: string) => Promise<{ width: number; height: number } | null>
  /**
   * Reads a video's display size and duration; absent in tests, which is the
   * same "no dimensions" a clip in a format the probe cannot parse gets.
   */
  probeVideoMeta?: (filePath: string) => Promise<{
    width: number
    height: number
    duration: number
  } | null>
}

/**
 * Fake adapter: lets the whole UI be built and demoed without credentials.
 * Selected automatically when TELEGRAM_API_ID / TELEGRAM_API_HASH are absent.
 *
 * Media is real: PNG/WebP/TGS files are written under userData once and served
 * through the same `wx-media://` protocol the TDLib adapter uses, so downloads,
 * sticker rendering and the URL plumbing are exercised without an account.
 *
 * The pieces live beside this file: the fixtures (`fixtures.ts`), the generated
 * media (`assets.ts`), the avatars (`avatars.ts`) and the ambient traffic
 * (`traffic.ts`).
 */
export class MockAdapter extends AdapterEmitter implements TelegramAdapter {
  readonly kind = 'mock' as const
  readonly label = 'Mock adapter'

  private auth: AuthState = { kind: 'idle' }
  private connection: ConnectionState = 'offline'
  private readonly fixtures = new Map<number, Fixture>()
  /**
   * The comment endpoints live in `./comments.ts`; fields keep this file small.
   * Threads post the same rows a chat does, so they borrow `sendDeps` — read
   * lazily, because the assets exist only after the constructor ran.
   */
  private readonly commentApi = createMockComments(
    this.fixtures,
    (event) => this.emit(event),
    () => this.sendDeps(),
  )
  readonly comments = this.commentApi.comments
  readonly commentInfo = this.commentApi.info
  readonly joinCommentGroup = this.commentApi.join
  readonly sendComment = this.commentApi.send
  private readonly assets: MockAssets
  private readonly avatars: MockAvatars
  /** The fixture pack's install flags, written by the pack page. */
  private readonly stickerSetState = initialMockStickerSetState()
  /** 消息通知's scope defaults; in memory, like every other fixture write. */
  private readonly mockNotifications = createMockNotifications()
  /**
   * 数据与存储: a plausible cache for the fixture account (the shared demo numbers
   * live in `@wegram/mock-fixtures`). The generated media is a few megabytes, but
   * the group's whole point is rows big enough to trim and clear, so dropping
   * them changes only these numbers — nothing in `mock-media` is deleted.
   */
  private mockStorage: StorageUsage = initialMockStorage()
  private nextMessageId = 5000
  private nextFileId = 9000
  private timer: NodeJS.Timeout | null = null
  /**
   * `WEGRAM_MOCK_FAIL_SEND=1` fails the next text send once, so the 未发送 row and
   * 重试 can be exercised without a network: the retry then succeeds normally.
   */
  private failNextSend = /^(1|true|yes|on)$/i.test(
    process.env['WEGRAM_MOCK_FAIL_SEND']?.trim() ?? '',
  )
  /** Pending fake QR confirmation; the scan is simulated on this timer. */
  private qrTimer: NodeJS.Timeout | null = null

  constructor(private readonly options: MockAdapterOptions) {
    super()
    this.assets = new MockAssets(options.registerMedia)
    // Built here, not as a field initializer: it reads `assets`, which only exists
    // once this constructor has made it.
    this.sends = createMockSends({
      fixtures: this.fixtures,
      assets: this.assets,
      emit: (event) => this.emit(event),
      sendDeps: () => this.sendDeps(),
      takeMessageId: () => this.nextMessageId++,
      failNextSend: () => {
        if (!this.failNextSend) return false
        this.failNextSend = false
        return true
      },
    })
    this.sendText = this.sends.sendText
    this.sendMedia = this.sends.sendMedia
    this.cancelSend = this.sends.cancelSend
    this.sendAlbum = this.sends.sendAlbum
    this.sendSticker = this.sends.sendSticker
    this.sendVoiceNote = this.sends.sendVoice
    this.avatars = new MockAvatars({
      mediaDir: options.mediaDir,
      registerMedia: options.registerMedia,
      fixtures: this.fixtures,
      emit: (event) => this.emit(event),
    })
  }

  async start(): Promise<void> {
    await this.assets.materialize(this.options.mediaDir)
    const built = buildFixtures((fileId, extra, options) =>
      this.assets.mediaOf(fileId, extra, options),
    )
    this.fixtures.clear()
    for (const [chatId, fixture] of built) this.fixtures.set(chatId, fixture)
    this.avatars.attach()
    this.setAuth({ kind: 'waitPhoneNumber' })
    this.setConnection('offline')
    this.timer = setInterval(() => this.simulateTraffic(), 12_000)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.avatars.dispose()
    this.clearQrTimer()
  }

  getAuthState(): AuthState {
    return this.auth
  }

  /**
   * The mock has no client to load: it is up as soon as the adapter exists, and a
   * half-written fixture folder is a development error, not a Telegram outage.
   */
  getBootState(): BootState {
    return { kind: 'ready' }
  }

  getConnectionState(): ConnectionState {
    return this.connection
  }

  async submitPhone(phone: string): Promise<AuthState> {
    if (!phone.trim().startsWith('+')) {
      throw new AppError(
        'auth_failed',
        'Phone number must start with a country code, e.g. +8613800000000',
      )
    }
    this.setAuth({
      kind: 'waitCode',
      hint: `sent to ${phone.trim()}`,
      codeLength: MOCK_CODE.length,
    })
    return this.auth
  }

  async submitCode(code: string): Promise<AuthState> {
    if (code.trim() !== MOCK_CODE) {
      throw new AppError('auth_failed', `Mock verification code is ${MOCK_CODE}`)
    }
    this.setAuth({
      kind: 'waitPassword',
      hint: 'two-step verification (mock password: wegram)',
    })
    return this.auth
  }

  /**
   * The mock's phone → code → password flow always ends in a ready account, so
   * it never reaches `waitRegistration`; refuse instead of inventing a step.
   */
  async signUp(): Promise<AuthState> {
    throw new AppError('invalid_payload', 'Mock 适配器没有注册步骤')
  }

  async submitPassword(password: string): Promise<AuthState> {
    if (password !== MOCK_PASSWORD) {
      throw new AppError('auth_failed', 'Wrong mock password, use "wegram"')
    }
    this.completeLogin()
    return this.auth
  }

  /**
   * QR login: TDLib would hand us a fresh `tg://login?token=…` link every few
   * seconds. The mock mints one and then "scans" it after ten seconds, so the
   * whole first-login flow (QR → shell, no profile step) can be exercised
   * without a second device.
   */
  async requestQrCode(): Promise<AuthState> {
    if (this.auth.kind !== 'waitPhoneNumber') return this.auth
    this.setAuth({ kind: 'waitQr', link: `tg://login?token=${randomUUID()}` })
    this.clearQrTimer()
    this.qrTimer = setTimeout(() => {
      this.qrTimer = null
      this.completeLogin()
    }, 10_000)
    return this.auth
  }

  /** TDLib cannot cancel a QR confirmation; the mock can simply start over. */
  async restartAuth(): Promise<AuthState> {
    this.clearQrTimer()
    this.setAuth({ kind: 'waitPhoneNumber' })
    return this.auth
  }

  async logout(): Promise<void> {
    this.clearQrTimer()
    this.setAuth({ kind: 'waitPhoneNumber' })
    this.setConnection('offline')
  }

  async me(): Promise<Self> {
    if (this.auth.kind !== 'ready') throw new AppError('auth_required', 'Not signed in')
    const avatarUrl = this.assets.selfAvatarUrl
    return avatarUrl ? { ...this.auth.me, avatarUrl } : this.auth.me
  }

  /** The chat endpoints; their rules live in ./chats.ts. */
  private readonly chatApi = createMockChats(this.fixtures, (event) => this.emit(event))
  /** Poll voting / adding options; see ./polls.ts. */
  private readonly pollApi = createMockPolls(this.fixtures, (event) => this.emit(event))
  readonly votePoll = this.pollApi.votePoll
  readonly addPollOption = this.pollApi.addPollOption
  readonly refreshPoll = this.pollApi.refreshPoll
  readonly listChats = this.chatApi.listChats
  readonly prefetchChatAvatars = this.chatApi.prefetchAvatars
  readonly getChat = this.chatApi.getChat
  readonly openChat = this.chatApi.openChat
  readonly openPrivateChat = this.chatApi.openPrivateChat
  readonly openUsernameChat = this.chatApi.openUsernameChat
  readonly canPost = this.chatApi.canPost
  readonly canGetMembers = this.chatApi.canGetMembers
  readonly chatJoinState = this.chatApi.joinState
  readonly joinChannel = this.chatApi.join
  readonly setChatMuted = this.chatApi.setMuted
  readonly setChatPinned = this.chatApi.setPinned
  readonly setChatArchived = this.chatApi.setArchived
  readonly clearHistory = this.chatApi.clearHistory
  readonly deleteChat = this.chatApi.deleteChat
  readonly setChatUnread = this.chatApi.setChatUnread
  readonly chatMembers = this.chatApi.members
  readonly setChatTitle = this.chatApi.setTitle
  readonly leaveChat = this.chatApi.leave
  readonly pinnedMessage = this.chatApi.pinnedMessage
  readonly setPinnedMessage = this.chatApi.setPinnedMessage
  readonly inviteLink = this.chatApi.inviteLink
  readonly addChatMember = this.chatApi.addMember

  /** 话题 (design doc §9.12); their rules live in ./topics.ts. */
  private readonly topicApi = createMockTopics({
    fixtures: this.fixtures,
    emit: (event) => this.emit(event),
  })
  readonly topics = this.topicApi.list
  readonly createTopic = this.topicApi.create
  readonly editTopic = this.topicApi.edit
  readonly setTopicPinned = this.topicApi.setPinned
  readonly setTopicClosed = this.topicApi.setClosed
  readonly setTopicMuted = this.topicApi.setMuted
  readonly topicIcons = this.topicApi.icons
  /** The fixture is a sidebar forum; the tabs layout is a real-TDLib concern. */
  async forumLayout(): Promise<'tabs' | 'sidebar'> {
    return 'sidebar'
  }
  readonly deleteTopic = this.topicApi.remove
  readonly topicLink = this.topicApi.link
  readonly setViewAsTopics = this.topicApi.setViewAsTopics
  readonly userStatus = this.chatApi.userStatus

  /** 资料卡's data and its two writes; the rules live in ./users.ts. */
  private readonly users = createMockUsers(this.fixtures)
  async userProfile(userId: number) {
    return this.users.profile({ userId })
  }
  async commonChats(input: { userId: number; offset?: number; limit?: number }) {
    return this.users.commonChats(input)
  }
  async setUserNote(userId: number, note: string) {
    return this.users.setNote({ userId, note })
  }
  async setUserContact(userId: number, contact: boolean) {
    return this.users.setContact({ userId, contact })
  }
  async setUserBlocked(userId: number, blocked: boolean) {
    return this.users.setBlocked({ userId, blocked })
  }
  async reportUser(userId: number, input: { optionId?: string; text?: string }) {
    return this.users.report({ userId, ...input })
  }
  async reportMessage(input: {
    chatId: number
    messageId: number
    optionId?: string
    text?: string
  }) {
    return this.users.reportMessage(input)
  }

  /**
   * The fixture bot: its commands (the composer's "/" list), a pressed inline
   * button, and inline queries. `bots.ts` owns the canned answers.
   */
  async botCommands(chatId: number) {
    return this.bots.commands(chatId)
  }
  async pressCallback(input: {
    chatId: number
    messageId: number
    callback: InlineButtonCallback
  }) {
    return this.bots.callback(input)
  }
  async inlineQuery(input: { chatId: number; username: string; query: string; offset?: string }) {
    return this.bots.inlineQuery(input)
  }
  /**
   * An inline result is sent by the bot, not by this client: the fake answers the
   * text it promised and the row goes through the mock's own send path, so the
   * renderer sees exactly what a real `sendInlineQueryResultMessage` produces.
   */
  async sendInlineResult(input: {
    chatId: number
    topicId?: number
    queryId: string
    resultId: string
  }) {
    const text = this.bots.inlineResultText(input)
    return this.sends.sendText({
      chatId: input.chatId,
      ...(input.topicId === undefined ? {} : { topicId: input.topicId }),
      text,
    })
  }

  /** The mock address book; see `listMockContacts`. */
  async listContacts(): Promise<Contact[]> {
    return listMockContacts(this.fixtures)
  }

  async history(input: MockHistoryQuery): Promise<{ messages: Message[]; hasMore: boolean }> {
    return mockHistory({ fixtures: this.fixtures }, input)
  }

  async historyAround(
    input: MockAroundQuery,
  ): Promise<{ messages: Message[]; hasMore: boolean; hasNewer: boolean }> {
    return mockHistoryAround({ fixtures: this.fixtures }, input)
  }

  async historyNewer(input: MockNewerQuery): Promise<{ messages: Message[]; hasNewer: boolean }> {
    return mockHistoryNewer({ fixtures: this.fixtures }, input)
  }

  /**
   * Outgoing messages — text, one media file, 相册 and stickers. Every send builds a
   * row, appends it to the fixture and starts the fake upload, so their rules live
   * in ./sends.ts and this class only binds them.
   */
  private readonly sends: ReturnType<typeof createMockSends>
  /** The fixture bot's canned answers (commands / callbacks / inline queries). */
  private readonly bots = createMockBots(this.fixtures)
  readonly sendText: TelegramAdapter['sendText']
  readonly sendMedia: TelegramAdapter['sendMedia']
  readonly cancelSend: TelegramAdapter['cancelSend']
  readonly sendAlbum: TelegramAdapter['sendAlbum']
  readonly sendSticker: TelegramAdapter['sendSticker']
  readonly sendVoiceNote: TelegramAdapter['sendVoiceNote']

  /** What the outgoing-message builders need; also handed to the comment threads. */
  private sendDeps(): MockSendDeps {
    return {
      assets: this.assets,
      registerMedia: this.options.registerMedia,
      probeImageSize: this.options.probeImageSize,
      ...(this.options.probeVideoMeta ? { probeVideoMeta: this.options.probeVideoMeta } : {}),
      nextFileId: () => this.nextFileId++,
    }
  }

  async listStickerSets(): Promise<StickerSetSummary[]> {
    return listMockStickerSets(this.assets, this.stickerSetState)
  }

  async getStickerSet(setId: string): Promise<StickerSet> {
    return getMockStickerSet(this.assets, this.stickerSetState, setId)
  }

  /**
   * 即时预览 (design doc §8.9): every link answers the same demo page. The blocks
   * are built by `@wegram/mock-fixtures`, so the browser preview shows the same
   * page through the same renderer.
   */
  async instantView(url: string): Promise<InstantView> {
    return buildInstantView(url, (fileId, extra) => this.assets.mediaOf(fileId, extra))
  }

  async changeStickerSet(
    setId: string,
    change: { installed: boolean; archived?: boolean },
  ): Promise<void> {
    changeMockStickerSet(this.stickerSetState, setId, change)
    // The panel refetches on the same event the real adapter emits.
    this.emit({ type: 'stickerSets' })
  }

  async customEmojiStickers(ids: string[]): Promise<CustomEmojiSticker[]> {
    return listMockCustomEmoji(this.assets, ids)
  }

  /**
   * Message edits — 编辑, 编辑说明, delete and 重试. They all rewrite one fixture row
   * and announce the op that describes it, so their rules live in ./edits.ts and
   * this class only binds them.
   */
  private readonly edits = createMockEdits(this.fixtures, (event) => this.emit(event))
  readonly editText = this.edits.editText
  readonly editCaption = this.edits.editCaption
  readonly deleteMessages = this.edits.deleteMessages
  readonly resendMessages = this.edits.resendMessages
  readonly transcribeMessage = this.edits.transcribe

  async messageProperties(input: {
    chatId: number
    messageId: number
  }): Promise<MessageProperties> {
    return mockMessageProperties({ fixtures: this.fixtures }, input)
  }

  async forwardMessages(input: {
    fromChatId: number
    messageIds: number[]
    toChatId: number
    toTopicId?: number
  }): Promise<void> {
    const source = this.requireFixture(input.fromChatId)
    const target = this.requireFixture(input.toChatId)
    for (const id of input.messageIds) {
      const original = source.messages.find((m) => m.id === id)
      if (!original) continue
      target.messages.push({
        ...original,
        id: this.nextMessageId++,
        chatId: input.toChatId,
        // 转发来源: the copy names where the words came from, like TDLib's
        // forward_info on the new message (see @wegram/mock-session/forward).
        forward: forwardedOrigin(original),
        ...(input.toTopicId === undefined ? { topicId: undefined } : { topicId: input.toTopicId }),
      })
    }
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...target.chat } }] })
  }

  /** 对方正在输入: a fixture peer never reads it, so the mock only acknowledges. */
  async sendTyping(_chatId: number, _typing: boolean): Promise<void> {
    // Nothing to tell a fake peer.
  }

  async markRead(input: {
    chatId: number
    topicId?: number
    upToMessageId: number
  }): Promise<void> {
    if (input.topicId !== undefined) {
      // 话题内已读: one topic's counter and the chat's sum, not the whole chat's.
      await this.topicApi.markRead(input.chatId, input.topicId, input.upToMessageId)
      return
    }
    applyRead(
      { fixtures: this.fixtures, emit: (event) => this.emit(event) },
      input.chatId,
      input.upToMessageId,
    )
  }

  async searchGlobal(input: { q: string; limit: number }): Promise<ChatSummary[]> {
    return searchChats(this.fixtures, input.q, input.limit)
  }

  async searchInChat(input: {
    chatId: number
    topicId?: number
    q: string
    filter?: 'photo' | 'video' | 'file' | 'url'
    fromMessageId?: number
  }): Promise<Message[]> {
    const found = searchMessages(this.fixtures, input)
    return input.topicId === undefined
      ? found
      : found.filter((message) => message.topicId === input.topicId)
  }

  async searchMessages(input: {
    q: string
    scope: 'chat' | 'channel'
    limit: number
    cursor?: SearchMessagesCursor
  }): Promise<{
    messages: Message[]
    chats: ChatSummary[]
    total: number
    cursor: SearchMessagesCursor
  }> {
    return searchMessagesInScope(this.fixtures, input)
  }

  async downloadFile(input: { fileId: number; priority: number }) {
    return downloadMockFile(this.assets, (event) => this.emit(event), input)
  }

  async beginStream(input: { fileId: number; offset: number; priority: number }) {
    return beginMockStream(this.assets, input)
  }

  async downloadedPrefix(input: { fileId: number; offset: number }) {
    return mockDownloadedPrefix(this.assets, input)
  }

  async cancelDownload(_fileId: number) {
    // Local fixtures: there is no transfer to stop.
  }

  async setProxy(config: ProxyConfig | null): Promise<void> {
    // Mock adapter only reports whether a proxy is configured.
    console.log(
      '[mock] proxy updated:',
      config ? `${config.type} ${config.host}:${config.port}` : 'disabled',
    )
  }

  async testProxy(_config: ProxyConfig): Promise<ProxyTestResult> {
    return { ok: true, latencyMs: 1 }
  }

  async setPreferIpv6(_prefer: boolean): Promise<void> {
    // Fixtures never leave the machine: there is no address family to prefer.
  }

  async notificationScopes(): Promise<NotificationScopes> {
    return this.mockNotifications.all()
  }

  async setNotificationScope(
    scope: NotificationScope,
    settings: ScopeNotificationSettings,
  ): Promise<void> {
    this.mockNotifications.set(scope, settings)
  }

  async storageUsage(): Promise<StorageUsage> {
    return {
      ...this.mockStorage,
      buckets: this.mockStorage.buckets.map((bucket) => ({ ...bucket })),
    }
  }

  async trimStorage(maxBytes: number): Promise<StorageFreed> {
    const next = trimMockStorage(this.mockStorage, maxBytes)
    this.mockStorage = next.usage
    return next.freed
  }

  async clearStorage(kinds: StorageMediaKind[]): Promise<StorageFreed> {
    const next = clearMockStorage(this.mockStorage, kinds)
    this.mockStorage = next.usage
    return next.freed
  }

  /* ---------- fixture plumbing ---------- */

  private completeLogin(): void {
    this.clearQrTimer()
    const avatarUrl = this.assets.selfAvatarUrl
    this.setAuth({
      kind: 'ready',
      me: avatarUrl ? { ...ME, avatarUrl } : ME,
    })
    this.setConnection('online')
    this.emit({
      type: 'chats',
      ops: [...this.fixtures.values()].map((fixture) => ({
        op: 'upsert' as const,
        chat: { ...fixture.chat },
      })),
    })
    this.avatars.schedule()
  }

  private clearQrTimer(): void {
    if (this.qrTimer) clearTimeout(this.qrTimer)
    this.qrTimer = null
  }

  private setAuth(state: AuthState): void {
    this.auth = state
    this.emit({ type: 'auth', state })
  }

  private setConnection(state: ConnectionState): void {
    this.connection = state
    this.emit({ type: 'connection', state })
  }

  private requireFixture(chatId: number): Fixture {
    const fixture = this.fixtures.get(chatId)
    if (!fixture) throw new AppError('internal', `Unknown mock chat ${chatId}`)
    return fixture
  }

  private requireMessage(chatId: number, messageId: number): Message {
    const found = this.requireFixture(chatId).messages.find((m) => m.id === messageId)
    if (!found) throw new AppError('internal', `Unknown mock message ${messageId}`)
    return found
  }

  private simulateTraffic(): void {
    emitTraffic({
      ready: this.auth.kind === 'ready',
      fixtures: this.fixtures,
      userAvatarUrls: this.avatars.urls,
      takeId: () => this.nextMessageId++,
      emit: (event) => this.emit(event),
    })
  }
}
