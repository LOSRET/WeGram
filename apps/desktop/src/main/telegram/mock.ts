import { AppError } from '@wechatgram/protocol'
import type {
  AuthState,
  ChatSummary,
  ConnectionState,
  Message,
  ProxyConfig,
  ProxyTestResult,
  Self,
} from '@wechatgram/protocol'

import { AdapterEmitter, type TelegramAdapter } from './adapter'

const ME: Self = {
  id: 1000,
  firstName: '本地',
  lastName: '账号',
  username: 'wechatgram_demo',
  phone: '+86 000 0000 0000',
}

const MOCK_CODE = '12345'
const MOCK_PASSWORD = 'wechatgram'

interface Fixture {
  chat: ChatSummary
  messages: Message[]
}

function at(minutesAgo: number): number {
  return Math.floor(Date.now() / 1000) - minutesAgo * 60
}

function text(chatId: number, id: number, minutesAgo: number, body: string, outgoing: boolean): Message {
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

function buildFixtures(): Map<number, Fixture> {
  const fixtures = new Map<number, Fixture>()

  fixtures.set(1, {
    chat: {
      id: 1,
      title: '文件传输助手',
      kind: 'private',
      unread: 0,
      pinned: true,
      muted: false,
      lastMessageText: '[图片] 设计稿 v3.png',
      lastMessageAt: at(3),
    },
    messages: [
      text(1, 101, 240, '本周的设计稿放这里', false),
      text(1, 102, 239, '收到，我晚点看', true),
      text(1, 103, 4, '设计稿 v3.png', false),
    ],
  })

  fixtures.set(2, {
    chat: {
      id: 2,
      title: 'WechatGram 产品群',
      kind: 'group',
      unread: 12,
      pinned: true,
      muted: false,
      lastMessageText: '虚拟列表的滚动锚定我这边先接',
      lastMessageAt: at(9),
    },
    messages: [
      text(2, 201, 120, 'TDLib 的登录链路已经通了', false),
      text(2, 202, 118, '那 UI 可以对着 mock 并行做', true),
      text(2, 203, 30, '贴纸三种格式记得一起做，别留到二期', false),
      text(2, 204, 9, '虚拟列表的滚动锚定我这边先接', false),
    ],
  })

  fixtures.set(3, {
    chat: {
      id: 3,
      title: '妈',
      kind: 'private',
      unread: 1,
      pinned: false,
      muted: false,
      lastMessageText: '晚上回来吃饭吗',
      lastMessageAt: at(25),
    },
    messages: [text(3, 301, 26, '降温了，多穿点', false), text(3, 302, 25, '晚上回来吃饭吗', false)],
  })

  fixtures.set(4, {
    chat: {
      id: 4,
      title: '前端周会',
      kind: 'group',
      unread: 3,
      pinned: false,
      muted: true,
      lastMessageText: '会议纪要已经放到共享盘',
      lastMessageAt: at(180),
    },
    messages: [text(4, 401, 180, '会议纪要已经放到共享盘', false)],
  })

  fixtures.set(5, {
    chat: {
      id: 5,
      title: 'Telegram News',
      kind: 'channel',
      unread: 0,
      pinned: false,
      muted: false,
      lastMessageText: 'Telegram 11.0 released',
      lastMessageAt: at(600),
    },
    messages: [text(5, 501, 600, 'Telegram 11.0 released', false)],
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
  fixtures.set(99, {
    chat: {
      id: 99,
      title: '性能测试群 · 5000 条',
      kind: 'group',
      unread: 0,
      pinned: false,
      muted: true,
      lastMessageText: bulk[bulk.length - 1]?.text ?? '',
      lastMessageAt: at(0),
    },
    messages: bulk,
  })

  return fixtures
}

/**
 * Fake adapter: lets the whole UI be built and demoed without credentials.
 * Selected automatically when TELEGRAM_API_ID / TELEGRAM_API_HASH are absent.
 */
export class MockAdapter extends AdapterEmitter implements TelegramAdapter {
  readonly kind = 'mock' as const
  readonly label = 'Mock adapter'

  private auth: AuthState = { kind: 'idle' }
  private connection: ConnectionState = 'offline'
  private readonly fixtures = buildFixtures()
  private nextMessageId = 5000
  private timer: NodeJS.Timeout | null = null

  async start(): Promise<void> {
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
      throw new AppError('auth_failed', 'Phone number must start with a country code, e.g. +8613800000000')
    }
    this.setAuth({ kind: 'waitCode', hint: `sent to ${phone.trim()}`, codeLength: MOCK_CODE.length })
    return this.auth
  }

  async submitCode(code: string): Promise<AuthState> {
    if (code.trim() !== MOCK_CODE) {
      throw new AppError('auth_failed', `Mock verification code is ${MOCK_CODE}`)
    }
    this.setAuth({ kind: 'waitPassword', hint: 'two-step verification (mock password: wechatgram)' })
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
    return this.auth.me
  }

  async listChats(input: { limit: number; offset: number }): Promise<ChatSummary[]> {
    const all = [...this.fixtures.values()].map((f) => f.chat)
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
    const fixture = this.requireFixture(chatId)
    fixture.chat.unread = 0
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
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

  async deleteMessages(input: { chatId: number; messageIds: number[]; forBoth: boolean }): Promise<void> {
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
    const fixture = this.requireFixture(input.chatId)
    fixture.chat.unread = 0
    this.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
  }

  async searchGlobal(input: { q: string; limit: number }): Promise<ChatSummary[]> {
    const needle = input.q.toLowerCase()
    const all = [...this.fixtures.values()].map((f) => f.chat)
    return all
      .filter((chat) => chat.title.toLowerCase().includes(needle))
      .slice(0, input.limit)
  }

  async searchInChat(input: { chatId: number; q: string; fromMessageId?: number }): Promise<Message[]> {
    const needle = input.q.toLowerCase()
    return this.requireFixture(input.chatId).messages.filter((m) =>
      m.text.toLowerCase().includes(needle),
    )
  }

  async downloadFile(input: { fileId: number; priority: number }): Promise<{ path: string }> {
    this.emit({ type: 'file', fileId: input.fileId, downloaded: 1, total: 1, path: 'mock://file' })
    return { path: 'mock://file' }
  }

  async uploadFile(): Promise<{ fileId: number }> {
    throw new AppError('not_implemented', 'File upload lands in W3')
  }

  async setProxy(config: ProxyConfig | null): Promise<void> {
    // Mock adapter only reports whether a proxy is configured.
    console.log('[mock] proxy updated:', config ? `${config.type} ${config.host}:${config.port}` : 'disabled')
  }

  async testProxy(config: ProxyConfig): Promise<ProxyTestResult> {
    return { ok: true, latencyMs: 1 }
  }

  private completeLogin(): void {
    this.setAuth({ kind: 'ready', me: ME })
    this.setConnection('online')
    this.emit({
      type: 'chats',
      ops: [...this.fixtures.values()].map((f) => ({ op: 'upsert' as const, chat: { ...f.chat } })),
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
    const fixtures = [...this.fixtures.values()]
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
