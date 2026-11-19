import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { AppError } from '@wegram/protocol'
import type {
  AuthState,
  ChatSummary,
  ConnectionState,
  ContactProfile,
  Message,
  MessageMedia,
  ProxyConfig,
  ProxyTestResult,
  Self,
  StickerSet,
  StickerSetSummary,
} from '@wegram/protocol'

import { probeImageSize } from '../../media/image-size'
import { registerMediaFile } from '../../media/registry'
import { AdapterEmitter, type MediaKind, type TelegramAdapter } from '../adapter'
import { MockAssets } from './assets'
import { MockAvatars } from './avatars'
import {
  ME,
  MOCK_CODE,
  MOCK_PASSWORD,
  mimeFromPath,
  type Fixture,
  type MockFile,
} from './constants'
import { applyRead, simulateTransfer } from './effects'
import { buildFixtures } from './fixtures'
import { getMockStickerSet, listMockStickerSets } from './stickers'
import { emitTraffic } from './traffic'

export interface MockAdapterOptions {
  /** Where generated fixture media is written (under userData). */
  mediaDir: string
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
  private readonly assets = new MockAssets()
  private readonly avatars: MockAvatars
  private nextMessageId = 5000
  private nextFileId = 9000
  private timer: NodeJS.Timeout | null = null
  /** Pending fake QR confirmation; the scan is simulated on this timer. */
  private qrTimer: NodeJS.Timeout | null = null

  constructor(private readonly options: MockAdapterOptions) {
    super()
    this.avatars = new MockAvatars({
      mediaDir: options.mediaDir,
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

  async listChats(input: { limit: number; offset: number }): Promise<ChatSummary[]> {
    const all = [...this.fixtures.values()].map((fixture) => fixture.chat)
    all.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
    })
    return all.slice(input.offset, input.offset + input.limit)
  }

  async getChat(chatId: number): Promise<ChatSummary> {
    return this.requireFixture(chatId).chat
  }

  async openChat(chatId: number): Promise<void> {
    // Opening does not consume the unread messages: the renderer reports
    // `messages:read` per viewport (see `tdlib/actions.openChat`).
    this.requireFixture(chatId)
  }

  /** The mock has no user directory; reuse the private chat that carries that id. */
  async openPrivateChat(userId: number): Promise<ChatSummary> {
    const fixture =
      [...this.fixtures.values()].find((item) => item.chat.userId === userId) ??
      [...this.fixtures.values()].find((item) => item.chat.kind === 'private')
    if (!fixture)
      throw new AppError('not_implemented', `mock has no private chat for user ${userId}`)
    return fixture.chat
  }

  async canPost(chatId: number): Promise<boolean> {
    const fixture = this.requireFixture(chatId)
    // Groups and private chats keep the composer; only channels gate on rights.
    return fixture.chat.kind === 'channel' ? Boolean(fixture.canPost) : true
  }

  async setChatMuted(chatId: number, muted: boolean): Promise<ChatSummary> {
    const fixture = this.requireFixture(chatId)
    fixture.chat.muted = muted
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
    return { ...fixture.chat }
  }

  /** The 通讯录 detail pane's identity block, from the fixture's `contact`. */
  async contactProfile(chatId: number): Promise<ContactProfile> {
    const fixture = this.requireFixture(chatId)
    return {
      chatId,
      ...(fixture.chat.userId ? { userId: fixture.chat.userId } : {}),
      ...(fixture.contact?.username ? { username: fixture.contact.username } : {}),
      ...(fixture.contact?.phone ? { phone: fixture.contact.phone } : {}),
    }
  }

  async history(input: {
    chatId: number
    fromMessageId?: number
    limit: number
  }): Promise<{ messages: Message[]; hasMore: boolean }> {
    const all = this.requireFixture(input.chatId).messages
    const upper = input.fromMessageId ? all.filter((m) => m.id < input.fromMessageId!) : all
    const slice = upper.slice(Math.max(0, upper.length - input.limit))
    return { messages: slice.map((m) => ({ ...m })), hasMore: upper.length > slice.length }
  }

  async historyAround(input: {
    chatId: number
    messageId: number
    limit: number
  }): Promise<{ messages: Message[]; hasMore: boolean; hasNewer: boolean }> {
    const all = this.requireFixture(input.chatId).messages
    const found = all.findIndex((message) => message.id === input.messageId)
    const center = found >= 0 ? found : all.findIndex((message) => message.id > input.messageId)
    if (center < 0) return { messages: [], hasMore: true, hasNewer: false }
    const start = Math.max(0, center - input.limit)
    const end = Math.min(all.length, center + input.limit + 1)
    return {
      messages: all.slice(start, end).map((message) => ({ ...message })),
      hasMore: start > 0,
      hasNewer: end < all.length,
    }
  }

  async historyNewer(input: {
    chatId: number
    fromMessageId: number
    limit: number
  }): Promise<{ messages: Message[]; hasNewer: boolean }> {
    const all = this.requireFixture(input.chatId).messages
    const newer = all.filter((message) => message.id > input.fromMessageId)
    return {
      messages: newer.slice(0, input.limit).map((message) => ({ ...message })),
      hasNewer: newer.length > input.limit,
    }
  }

  async sendText(input: {
    chatId: number
    text: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    const fixture = this.requireFixture(input.chatId)
    const message: Message = {
      id: this.nextMessageId++,
      chatId: input.chatId,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: Math.floor(Date.now() / 1000),
      kind: 'text',
      text: input.text,
      ...(input.replyTo === undefined ? {} : { replyToId: input.replyTo }),
    }
    fixture.messages.push(message)
    fixture.chat.lastMessageText = input.text
    fixture.chat.lastMessageAt = message.date
    this.emit({ type: 'messages', chatId: input.chatId, ops: [{ op: 'new', message }] })
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
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
    const size = input.kind === 'photo' ? await probeImageSize(input.filePath) : null
    const fileId = this.nextFileId++
    const file: MockFile = {
      fileId,
      path: input.filePath,
      url: registerMediaFile(input.filePath),
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
    const message: Message = {
      id: this.nextMessageId++,
      chatId: input.chatId,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: Math.floor(Date.now() / 1000),
      kind: input.kind === 'photo' && size ? 'photo' : 'file',
      text: input.caption ?? '',
      media,
      ...(input.replyTo === undefined ? {} : { replyToId: input.replyTo }),
    }
    fixture.messages.push(message)
    fixture.chat.lastMessageText = `[${message.kind === 'photo' ? '图片' : '文件'}] ${file.name}`
    fixture.chat.lastMessageAt = message.date
    this.emit({ type: 'messages', chatId: input.chatId, ops: [{ op: 'new', message }] })
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
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
    const message: Message = {
      id: this.nextMessageId++,
      chatId: input.chatId,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: Math.floor(Date.now() / 1000),
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
      ...(input.replyTo === undefined ? {} : { replyToId: input.replyTo }),
    }
    fixture.messages.push(message)
    fixture.chat.lastMessageText = `[贴纸] ${sticker.emoji ?? ''}`.trim()
    fixture.chat.lastMessageAt = message.date
    this.emit({ type: 'messages', chatId: input.chatId, ops: [{ op: 'new', message }] })
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
    return { localId: `mock-${message.id}`, message }
  }

  async listStickerSets(): Promise<StickerSetSummary[]> {
    return listMockStickerSets(this.assets)
  }

  async getStickerSet(setId: string): Promise<StickerSet> {
    return getMockStickerSet(this.assets, setId)
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
    const needle = input.q.toLowerCase()
    const all = [...this.fixtures.values()].map((fixture) => fixture.chat)
    return all.filter((chat) => chat.title.toLowerCase().includes(needle)).slice(0, input.limit)
  }

  async searchInChat(input: {
    chatId: number
    q: string
    fromMessageId?: number
  }): Promise<Message[]> {
    const needle = input.q.toLowerCase()
    return this.requireFixture(input.chatId).messages.filter((m) =>
      m.text.toLowerCase().includes(needle),
    )
  }

  async downloadFile(input: {
    fileId: number
    priority: number
  }): Promise<{ path: string; url: string }> {
    const file = this.assets.files.get(input.fileId)
    if (!file) throw new AppError('internal', `Unknown mock file ${input.fileId}`)
    await simulateTransfer(
      { files: this.assets.files, emit: (event) => this.emit(event) },
      input.fileId,
      file.size,
      false,
    )
    return { path: file.path, url: file.url }
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
