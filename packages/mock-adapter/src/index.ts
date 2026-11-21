import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { AppError } from '@wegram/protocol'
import type {
  AuthState,
  BootState,
  ChatSummary,
  ConnectionState,
  Contact,
  CustomEmojiSticker,
  Message,
  MessageMedia,
  MessageProperties,
  ProxyConfig,
  ProxyTestResult,
  SearchMessagesCursor,
  Self,
  StickerSet,
  StickerSetSummary,
} from '@wegram/protocol'

import { AdapterEmitter, type MediaKind, type TelegramAdapter } from '@wegram/adapter-contract'
import { MockAssets } from './assets'
import { MockAvatars } from './avatars'
import { createMockChats } from './chats'
import { createMockComments } from './comments'
import { listMockContacts } from './contacts'
import {
  ME,
  MOCK_CODE,
  MOCK_PASSWORD,
  mimeFromPath,
  type Fixture,
  type MockFile,
} from './constants'
import { applyRead, simulateTransfer } from './effects'
import { beginMockStream, downloadMockFile, mockDownloadedPrefix } from './files'
import { buildFixtures } from './fixtures'
import {
  mockHistory,
  mockHistoryAround,
  mockHistoryNewer,
  type MockAroundQuery,
  type MockHistoryQuery,
  type MockNewerQuery,
} from './history'
import { mockMessageProperties } from './properties'
import { searchChats, searchMessages, searchMessagesInScope } from './search'
import { getMockStickerSet, listMockCustomEmoji, listMockStickerSets } from './stickers'
import { emitTraffic } from './traffic'
import { appendMessage, outgoingMessage } from './transcript'

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
  /** The comment endpoints live in `./comments.ts`; fields keep this file small. */
  private readonly commentApi = createMockComments(this.fixtures, (event) => this.emit(event))
  readonly comments = this.commentApi.comments
  readonly commentInfo = this.commentApi.info
  readonly joinCommentGroup = this.commentApi.join
  readonly sendComment = this.commentApi.send
  private readonly assets: MockAssets
  private readonly avatars: MockAvatars
  private nextMessageId = 5000
  private nextFileId = 9000
  private timer: NodeJS.Timeout | null = null
  /** Pending fake QR confirmation; the scan is simulated on this timer. */
  private qrTimer: NodeJS.Timeout | null = null

  constructor(private readonly options: MockAdapterOptions) {
    super()
    this.assets = new MockAssets(options.registerMedia)
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
  readonly listChats = this.chatApi.listChats
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
  readonly clearHistory = this.chatApi.clearHistory
  readonly chatMembers = this.chatApi.members
  readonly setChatTitle = this.chatApi.setTitle
  readonly leaveChat = this.chatApi.leave
  readonly pinnedMessage = this.chatApi.pinnedMessage
  readonly inviteLink = this.chatApi.inviteLink

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

  async sendText(input: {
    chatId: number
    text: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    const fixture = this.requireFixture(input.chatId)
    const message = outgoingMessage({
      id: this.nextMessageId++,
      chatId: input.chatId,
      kind: 'text',
      text: input.text,
      replyTo: input.replyTo,
    })
    appendMessage({ emit: (event) => this.emit(event) }, fixture, message, input.text)
    return { localId: `mock-${message.id}`, message }
  }

  async sendMedia(input: {
    chatId: number
    filePath: string
    kind: MediaKind
    caption?: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    const fixture = this.requireFixture(input.chatId)
    const info = await stat(input.filePath)
    const size = input.kind === 'photo' ? await this.options.probeImageSize(input.filePath) : null
    const fileId = this.nextFileId++
    const file: MockFile = {
      fileId,
      path: input.filePath,
      url: this.options.registerMedia(input.filePath),
      name: basename(input.filePath),
      size: info.size,
      mimeType: mimeFromPath(input.filePath),
      ...(size ?? {}),
    }
    this.assets.files.set(fileId, file)

    const media: MessageMedia = {
      fileId,
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      fileName: file.name,
      size: file.size,
      localUrl: file.url,
      ...(size ? { width: size.width, height: size.height } : {}),
    }
    const message = outgoingMessage({
      id: this.nextMessageId++,
      chatId: input.chatId,
      kind: input.kind === 'photo' && size ? 'photo' : 'file',
      text: input.caption ?? '',
      media,
      replyTo: input.replyTo,
    })
    appendMessage(
      { emit: (event) => this.emit(event) },
      fixture,
      message,
      `[${message.kind === 'photo' ? '图片' : '文件'}] ${file.name}`,
    )
    // Upload progress is reported asynchronously, like TDLib does.
    void simulateTransfer(
      { files: this.assets.files, emit: (event) => this.emit(event) },
      fileId,
      info.size,
      true,
    )
    return { localId: `mock-${message.id}`, message }
  }

  async sendSticker(input: {
    chatId: number
    fileId: number
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    const fixture = this.requireFixture(input.chatId)
    const sticker = this.assets.stickers.find((item) => item.fileId === input.fileId)
    const file = this.assets.files.get(input.fileId)
    if (!sticker || !file) throw new AppError('internal', `Unknown mock sticker ${input.fileId}`)
    const message = outgoingMessage({
      id: this.nextMessageId++,
      chatId: input.chatId,
      kind: 'sticker',
      text: '',
      media: {
        fileId: sticker.fileId,
        stickerFormat: sticker.format,
        ...(sticker.emoji ? { stickerEmoji: sticker.emoji } : {}),
        ...(sticker.width ? { width: sticker.width } : {}),
        ...(sticker.height ? { height: sticker.height } : {}),
        localUrl: file.url,
      },
      replyTo: input.replyTo,
    })
    appendMessage(
      { emit: (event) => this.emit(event) },
      fixture,
      message,
      `[贴纸] ${sticker.emoji ?? ''}`.trim(),
    )
    return { localId: `mock-${message.id}`, message }
  }

  async listStickerSets(): Promise<StickerSetSummary[]> {
    return listMockStickerSets(this.assets)
  }

  async getStickerSet(setId: string): Promise<StickerSet> {
    return getMockStickerSet(this.assets, setId)
  }

  async customEmojiStickers(ids: string[]): Promise<CustomEmojiSticker[]> {
    return listMockCustomEmoji(this.assets, ids)
  }

  async editText(input: { chatId: number; messageId: number; text: string }): Promise<Message> {
    const target = this.requireMessage(input.chatId, input.messageId)
    target.text = input.text
    target.edited = true
    this.emit({
      type: 'messages',
      chatId: input.chatId,
      ops: [{ op: 'edit', chatId: input.chatId, messageId: input.messageId, text: input.text }],
    })
    return { ...target }
  }

  async deleteMessages(input: {
    chatId: number
    messageIds: number[]
    forBoth: boolean
  }): Promise<void> {
    const fixture = this.requireFixture(input.chatId)
    fixture.messages = fixture.messages.filter((m) => !input.messageIds.includes(m.id))
    this.emit({
      type: 'messages',
      chatId: input.chatId,
      ops: [{ op: 'delete', chatId: input.chatId, messageIds: input.messageIds }],
    })
  }

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
  }): Promise<void> {
    const source = this.requireFixture(input.fromChatId)
    const target = this.requireFixture(input.toChatId)
    for (const id of input.messageIds) {
      const original = source.messages.find((m) => m.id === id)
      if (!original) continue
      target.messages.push({ ...original, id: this.nextMessageId++, chatId: input.toChatId })
    }
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...target.chat } }] })
  }

  async markRead(input: { chatId: number; upToMessageId: number }): Promise<void> {
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
    q: string
    fromMessageId?: number
  }): Promise<Message[]> {
    return searchMessages(this.fixtures, input)
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
