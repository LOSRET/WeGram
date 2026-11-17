import { statSync, writeFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { AppError } from '@wechatgram/protocol'
import type {
  AuthState,
  ChatSummary,
  ConnectionState,
  Message,
  MessageMedia,
  ProxyConfig,
  ProxyTestResult,
  Self,
  Sticker,
  StickerSet,
  StickerSetSummary,
} from '@wechatgram/protocol'

import { probeImageSize } from '../media/image-size'
import { registerMediaFile } from '../media/registry'
import { AdapterEmitter, type MediaKind, type TelegramAdapter } from './adapter'
import {
  SAMPLE_VIDEO_WEBM,
  STICKER_FACE_WEBP,
  STICKER_HEART_WEBP,
  STICKER_WAVE_TGS,
  createGradientPng,
} from './mock-assets'

const ME: Self = {
  id: 1000,
  firstName: '本地',
  lastName: '账号',
  username: 'wechatgram_demo',
  phone: '+86 000 0000 0000',
}

const MOCK_CODE = '12345'
const MOCK_PASSWORD = 'wechatgram'
const MOCK_STICKER_SET_ID = 'mock-stickers'

/** Gradient pairs for the generated chat photos, picked by chat id. */
const MOCK_AVATAR_COLORS: readonly (readonly [
  [number, number, number],
  [number, number, number],
])[] = [
  [
    [7, 193, 96],
    [12, 122, 78],
  ],
  [
    [96, 140, 250],
    [38, 62, 168],
  ],
  [
    [250, 128, 81],
    [188, 52, 92],
  ],
  [
    [168, 106, 232],
    [82, 48, 148],
  ],
  [
    [64, 178, 196],
    [24, 96, 128],
  ],
  [
    [236, 178, 74],
    [176, 96, 30],
  ],
]

interface Fixture {
  chat: ChatSummary
  messages: Message[]
}

interface MockFile {
  fileId: number
  path: string
  url: string
  name: string
  size: number
  mimeType: string
  width?: number
  height?: number
}

export interface MockAdapterOptions {
  /** Where generated fixture media is written (under userData). */
  mediaDir: string
}

function at(minutesAgo: number): number {
  return Math.floor(Date.now() / 1000) - minutesAgo * 60
}

function text(
  chatId: number,
  id: number,
  minutesAgo: number,
  body: string,
  outgoing: boolean,
): Message {
  return {
    id,
    chatId,
    senderId: outgoing ? ME.id : chatId * 10 + 7,
    senderName: outgoing ? '我' : '对方',
    outgoing,
    date: at(minutesAgo),
    kind: 'text',
    text: body,
  }
}

/**
 * Fake adapter: lets the whole UI be built and demoed without credentials.
 * Selected automatically when TELEGRAM_API_ID / TELEGRAM_API_HASH are absent.
 *
 * Media is real: PNG/WebP/TGS files are written under userData once and served
 * through the same `wx-media://` protocol the TDLib adapter uses, so downloads,
 * sticker rendering and the URL plumbing are exercised without an account.
 */
export class MockAdapter extends AdapterEmitter implements TelegramAdapter {
  readonly kind = 'mock' as const
  readonly label = 'Mock adapter'

  private auth: AuthState = { kind: 'idle' }
  private connection: ConnectionState = 'offline'
  private readonly fixtures = new Map<number, Fixture>()
  private readonly files = new Map<number, MockFile>()
  private readonly stickers: Sticker[] = []
  private nextMessageId = 5000
  private nextFileId = 9000
  private timer: NodeJS.Timeout | null = null
  /** Generated avatar for the rail, so the mock exercises the real image path. */
  private selfAvatarUrl: string | null = null

  constructor(private readonly options: MockAdapterOptions) {
    super()
  }

  async start(): Promise<void> {
    await this.materializeMedia()
    this.buildFixtures()
    this.attachAvatarFixtures()
    this.setAuth({ kind: 'waitPhoneNumber' })
    this.setConnection('offline')
    this.timer = setInterval(() => this.simulateTraffic(), 12_000)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
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
      hint: 'two-step verification (mock password: wechatgram)',
    })
    return this.auth
  }

  async submitPassword(password: string): Promise<AuthState> {
    if (password !== MOCK_PASSWORD) {
      throw new AppError('auth_failed', 'Wrong mock password, use "wechatgram"')
    }
    this.completeLogin()
    return this.auth
  }

  async logout(): Promise<void> {
    this.setAuth({ kind: 'waitPhoneNumber' })
    this.setConnection('offline')
  }

  async me(): Promise<Self> {
    if (this.auth.kind !== 'ready') throw new AppError('auth_required', 'Not signed in')
    return this.selfAvatarUrl ? { ...this.auth.me, avatarUrl: this.selfAvatarUrl } : this.auth.me
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
    this.applyRead(chatId)
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
    this.files.set(fileId, file)

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
    void this.simulateTransfer(fileId, info.size, true)
    return { localId: `mock-${message.id}`, message }
  }

  async sendSticker(input: {
    chatId: number
    fileId: number
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    const fixture = this.requireFixture(input.chatId)
    const sticker = this.stickers.find((item) => item.fileId === input.fileId)
    const file = this.files.get(input.fileId)
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
    const cover = this.stickers[0]
    return [
      {
        id: MOCK_STICKER_SET_ID,
        title: 'WechatGram 贴纸',
        ...(cover ? { thumbnail: cover } : {}),
      },
    ]
  }

  async getStickerSet(setId: string): Promise<StickerSet> {
    if (setId !== MOCK_STICKER_SET_ID)
      throw new AppError('internal', `Unknown sticker set ${setId}`)
    const cover = this.stickers[0]
    return {
      id: MOCK_STICKER_SET_ID,
      title: 'WechatGram 贴纸',
      ...(cover ? { thumbnail: cover } : {}),
      stickers: this.stickers.map((sticker) => ({ ...sticker })),
    }
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
    this.applyRead(input.chatId, input.upToMessageId)
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
    const file = this.files.get(input.fileId)
    if (!file) throw new AppError('internal', `Unknown mock file ${input.fileId}`)
    await this.simulateTransfer(input.fileId, file.size, false)
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

  /** Every fixture chat gets a generated photo, so the list exercises <img>. */
  private attachAvatarFixtures(): void {
    for (const [chatId, fixture] of this.fixtures) {
      const pair = MOCK_AVATAR_COLORS[chatId % MOCK_AVATAR_COLORS.length] ?? MOCK_AVATAR_COLORS[0]!
      const [from, to] = pair
      const path = join(this.options.mediaDir, `chat-avatar-${chatId}.png`)
      writeFileSync(path, createGradientPng(128, 128, from, to))
      fixture.chat.avatarUrl = registerMediaFile(path)
    }
  }

  private async materializeMedia(): Promise<void> {
    await mkdir(this.options.mediaDir, { recursive: true })

    const designPath = join(this.options.mediaDir, 'design-v3.png')
    await writeFile(designPath, createGradientPng(1200, 800, [34, 66, 120], [236, 168, 96]))
    const sunsetPath = join(this.options.mediaDir, 'sunset.png')
    await writeFile(sunsetPath, createGradientPng(900, 1200, [250, 170, 70], [90, 30, 110]))
    const specPath = join(this.options.mediaDir, '需求说明.md')
    await writeFile(
      specPath,
      '# 需求说明\n\n- 媒体收发：图片 / 文件，带进度\n- 贴纸：WebP / TGS / WebM\n- 搜索：全局 + 会话内\n',
      'utf8',
    )
    const facePath = join(this.options.mediaDir, 'sticker-face.webp')
    await writeFile(facePath, Buffer.from(STICKER_FACE_WEBP, 'base64'))
    const heartPath = join(this.options.mediaDir, 'sticker-heart.webp')
    await writeFile(heartPath, Buffer.from(STICKER_HEART_WEBP, 'base64'))
    const wavePath = join(this.options.mediaDir, 'sticker-wave.tgs')
    await writeFile(wavePath, Buffer.from(STICKER_WAVE_TGS, 'base64'))
    const clipPath = join(this.options.mediaDir, 'sample-video.webm')
    await writeFile(clipPath, Buffer.from(SAMPLE_VIDEO_WEBM, 'base64'))

    const avatarPath = join(this.options.mediaDir, 'self-avatar.png')
    await writeFile(avatarPath, createGradientPng(256, 256, [7, 193, 96], [24, 96, 180]))
    this.selfAvatarUrl = registerMediaFile(avatarPath)

    this.addFile(7001, facePath, '笑脸贴纸', 'image/webp', 128, 128)
    this.addFile(7002, heartPath, '爱心贴纸', 'image/webp', 128, 128)
    this.addFile(7003, wavePath, '旋转贴纸', 'application/gzip', 128, 128)
    this.addFile(7101, designPath, 'design-v3.png', 'image/png', 1200, 800)
    this.addFile(7102, sunsetPath, 'sunset.png', 'image/png', 900, 1200)
    this.addFile(7201, specPath, '需求说明.md', 'text/markdown')
    this.addFile(7301, clipPath, 'sample-video.webm', 'video/webm', 270, 480)

    this.stickers.push(
      { fileId: 7001, format: 'webp', emoji: '😀', width: 128, height: 128, thumbFileId: 7001 },
      { fileId: 7002, format: 'webp', emoji: '❤️', width: 128, height: 128, thumbFileId: 7002 },
      { fileId: 7003, format: 'tgs', emoji: '✨', width: 128, height: 128 },
    )
  }

  private addFile(
    fileId: number,
    path: string,
    name: string,
    mimeType: string,
    width?: number,
    height?: number,
  ): void {
    this.files.set(fileId, {
      fileId,
      path,
      url: registerMediaFile(path),
      name,
      size: statSync(path).size,
      mimeType,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    })
  }

  private mediaOf(
    fileId: number,
    extra: Partial<MessageMedia> = {},
    options: { downloadable?: boolean } = {},
  ): MessageMedia {
    const file = this.files.get(fileId)
    if (!file) throw new AppError('internal', `Unknown mock file ${fileId}`)
    return {
      fileId,
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      fileName: file.name,
      // A downloadable fixture starts with no URL: the renderer has to ask
      // `media:download`, which is what exercises the progress path.
      ...(options.downloadable ? {} : { localUrl: file.url }),
      ...(file.width ? { width: file.width } : {}),
      ...(file.height ? { height: file.height } : {}),
      ...extra,
    }
  }

  private buildFixtures(): void {
    this.fixtures.clear()

    this.fixtures.set(1, {
      chat: {
        id: 1,
        title: '文件传输助手',
        kind: 'private',
        unread: 0,
        pinned: true,
        muted: false,
        lastMessageText: '[视频] 这段录屏看一下',
        lastMessageAt: at(2),
        lastReadInboxMessageId: 106,
        lastReadOutboxMessageId: 106,
      },
      messages: [
        text(1, 101, 240, '本周的设计稿放这里', false),
        text(1, 102, 239, '收到，我晚点看', true),
        {
          id: 103,
          chatId: 1,
          senderId: ME.id,
          senderName: '我',
          outgoing: true,
          date: at(6),
          kind: 'photo',
          text: '设计稿 v3，先看这个方向',
          media: this.mediaOf(7101),
        },
        {
          id: 104,
          chatId: 1,
          senderId: ME.id,
          senderName: '我',
          outgoing: true,
          date: at(4),
          kind: 'file',
          text: '',
          media: this.mediaOf(7201),
        },
        {
          id: 105,
          chatId: 1,
          senderId: ME.id,
          senderName: '我',
          outgoing: true,
          date: at(3),
          kind: 'sticker',
          text: '',
          media: this.mediaOf(7001, { stickerFormat: 'webp', stickerEmoji: '😀' }),
        },
        {
          id: 106,
          chatId: 1,
          senderId: ME.id,
          senderName: '我',
          outgoing: true,
          date: at(2),
          kind: 'video',
          text: '这段录屏看一下',
          media: this.mediaOf(7301, { duration: 6 }),
        },
      ],
    })

    this.fixtures.set(2, {
      chat: {
        id: 2,
        title: 'WechatGram 产品群',
        kind: 'group',
        unread: 12,
        pinned: true,
        muted: false,
        lastMessageText: '[贴纸] ✨',
        lastMessageAt: at(1),
        lastReadInboxMessageId: 204,
        lastReadOutboxMessageId: 202,
      },
      messages: [
        text(2, 201, 120, 'TDLib 的登录链路已经通了', false),
        text(2, 202, 118, '那 UI 可以对着 mock 并行做', true),
        text(2, 203, 30, '贴纸三种格式记得一起做，别留到二期', false),
        text(2, 204, 9, '虚拟列表的滚动锚定我这边先接', false),
        {
          id: 205,
          chatId: 2,
          senderId: 27,
          senderName: '成员2',
          outgoing: false,
          date: at(5),
          kind: 'photo',
          text: '截个图给你',
          media: this.mediaOf(7102, {}, { downloadable: true }),
        },
        {
          id: 206,
          chatId: 2,
          senderId: 27,
          senderName: '成员2',
          outgoing: false,
          date: at(2),
          kind: 'sticker',
          text: '',
          media: this.mediaOf(7002, { stickerFormat: 'webp', stickerEmoji: '❤️' }),
        },
        {
          id: 207,
          chatId: 2,
          senderId: ME.id,
          senderName: '我',
          outgoing: true,
          date: at(1),
          kind: 'sticker',
          text: '',
          media: this.mediaOf(7003, { stickerFormat: 'tgs', stickerEmoji: '✨' }),
        },
      ],
    })

    this.fixtures.set(3, {
      chat: {
        id: 3,
        title: '妈',
        kind: 'private',
        unread: 1,
        pinned: false,
        muted: false,
        lastMessageText: '晚上回来吃饭吗',
        lastMessageAt: at(25),
        lastReadInboxMessageId: 301,
        lastReadOutboxMessageId: 0,
      },
      messages: [
        text(3, 301, 26, '降温了，多穿点', false),
        text(3, 302, 25, '晚上回来吃饭吗', false),
      ],
    })

    this.fixtures.set(4, {
      chat: {
        id: 4,
        title: '前端周会',
        kind: 'group',
        unread: 3,
        pinned: false,
        muted: true,
        lastMessageText: '会议纪要已经放到共享盘',
        lastMessageAt: at(180),
        lastReadInboxMessageId: 400,
        lastReadOutboxMessageId: 0,
      },
      messages: [text(4, 401, 180, '会议纪要已经放到共享盘', false)],
    })

    this.fixtures.set(5, {
      chat: {
        id: 5,
        title: 'Telegram News',
        kind: 'channel',
        unread: 0,
        pinned: false,
        muted: false,
        lastMessageText: 'Telegram 11.0 released',
        lastMessageAt: at(600),
        lastReadInboxMessageId: 502,
        lastReadOutboxMessageId: 0,
      },
      messages: [
        text(5, 501, 600, 'Telegram 11.0 released', false),
        // Channel posts are sent by the chat itself (`messageSenderChat`), not by a
        // user: senderId stays 0 and senderChatId + the chat title carry the name.
        {
          id: 502,
          chatId: 5,
          senderId: 0,
          senderChatId: 5,
          senderName: 'Telegram News',
          outgoing: false,
          date: at(600),
          kind: 'text',
          text: '频道消息：发送者是频道本身',
        },
      ],
    })

    // Stress fixture for the virtualised list (W2 acceptance: 5000 messages).
    const bulk: Message[] = []
    for (let index = 0; index < 5000; index += 1) {
      bulk.push({
        id: 10_000 + index,
        chatId: 99,
        senderId: index % 3 === 0 ? ME.id : 30 + (index % 5),
        senderName: index % 3 === 0 ? '我' : `成员${index % 5}`,
        outgoing: index % 3 === 0,
        date: at(600 - Math.floor(index / 10)),
        kind: 'text',
        text: `压测消息 #${index + 1}：这是一条用于验证虚拟滚动与锚定补偿的中等长度消息。`,
      })
    }
    this.fixtures.set(99, {
      chat: {
        id: 99,
        title: '性能测试群 · 5000 条',
        kind: 'group',
        unread: 0,
        pinned: false,
        muted: true,
        lastMessageText: bulk[bulk.length - 1]?.text ?? '',
        lastMessageAt: at(0),
        lastReadInboxMessageId: 10_000 + bulk.length - 1,
        lastReadOutboxMessageId: 0,
      },
      messages: bulk,
    })
  }

  /**
   * Marks everything up to `upToMessageId` read the way TDLib does: the marker only
   * moves forward and `unread` is whatever is still newer than it. Reporting the
   * marker (instead of always "0 unread") is what lets the renderer watch the chat
   * row and the rail badge fall message by message while the reader scrolls.
   */
  private applyRead(chatId: number, upToMessageId?: number): void {
    const fixture = this.requireFixture(chatId)
    const latest = fixture.messages[fixture.messages.length - 1]
    const upTo = upToMessageId ?? latest?.id
    if (upTo === undefined) return
    fixture.chat.lastReadInboxMessageId = Math.max(fixture.chat.lastReadInboxMessageId ?? 0, upTo)
    fixture.chat.unread = fixture.messages.filter(
      (message) => !message.outgoing && message.id > upTo,
    ).length
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
  }

  /** Drives `evt:file` so progress bars have something real to render. */
  private async simulateTransfer(fileId: number, total: number, uploading: boolean): Promise<void> {
    const steps = [0.12, 0.38, 0.71]
    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, 180))
      this.emit({
        type: 'file',
        fileId,
        downloaded: Math.round(total * step),
        total,
        ...(uploading ? { uploading: true } : {}),
      })
    }
    const file = this.files.get(fileId)
    await new Promise((resolve) => setTimeout(resolve, 180))
    this.emit({
      type: 'file',
      fileId,
      downloaded: total,
      total,
      ...(file ? { url: file.url } : {}),
      ...(uploading ? { uploading: true } : {}),
      completed: true,
    })
  }

  private completeLogin(): void {
    this.setAuth({
      kind: 'ready',
      me: this.selfAvatarUrl ? { ...ME, avatarUrl: this.selfAvatarUrl } : ME,
    })
    this.setConnection('online')
    this.emit({
      type: 'chats',
      ops: [...this.fixtures.values()].map((fixture) => ({
        op: 'upsert' as const,
        chat: { ...fixture.chat },
      })),
    })
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
    if (this.auth.kind !== 'ready') return
    const fixtures = [...this.fixtures.values()].filter((fixture) => fixture.chat.id !== 99)
    const target = fixtures[Math.floor(Math.random() * fixtures.length)]
    if (!target) return

    const message: Message = {
      id: this.nextMessageId++,
      chatId: target.chat.id,
      senderId: target.chat.id * 10 + 7,
      senderName: '对方',
      outgoing: false,
      date: Math.floor(Date.now() / 1000),
      kind: 'text',
      text: `（mock）新消息 #${this.nextMessageId - 5000}`,
    }
    target.messages.push(message)
    target.chat.lastMessageText = message.text
    target.chat.lastMessageAt = message.date
    target.chat.unread += 1

    this.emit({ type: 'messages', chatId: target.chat.id, ops: [{ op: 'new', message }] })
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...target.chat } }] })
    this.emit({
      type: 'typing',
      chatId: target.chat.id,
      userId: message.senderId,
      action: 'typing',
      until: Date.now() + 3000,
    })
  }
}

function mimeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'webm':
      return 'video/webm'
    case 'mp4':
      return 'video/mp4'
    case 'pdf':
      return 'application/pdf'
    case 'md':
      return 'text/markdown'
    case 'txt':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}
