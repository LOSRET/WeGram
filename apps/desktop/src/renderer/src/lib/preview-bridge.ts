import type {
  AppInfo,
  AppSettings,
  AuthState,
  ChatSummary,
  EventChannel,
  EventEnvelope,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
  Message,
  ProxyConfig,
  ProxyTestResult,
  Self,
  TgBridge,
} from '@wechatgram/protocol'

/**
 * Development-only bridge used when the renderer runs in a plain browser
 * (`pnpm web`). It mirrors just enough of the mock adapter to click through the
 * UI; the real source of truth is `main/telegram/mock.ts` + TDLib.
 *
 * Never install this when `window.tg` exists.
 */

const ME: Self = { id: 1000, firstName: '预览', lastName: '账号', username: 'preview' }

const now = () => Math.floor(Date.now() / 1000)

let seq = 0
const listeners = new Map<string, Set<(event: EventEnvelope<EventChannel>) => void>>()

function emit(channel: EventChannel, payload: unknown): void {
  seq += 1
  const envelope = { seq, payload } as EventEnvelope<EventChannel>
  for (const listener of listeners.get(channel) ?? []) listener(envelope)
}

let auth: AuthState = { kind: 'waitPhoneNumber' }

function setAuth(next: AuthState): AuthState {
  auth = next
  emit('evt:auth', next)
  return next
}

const chats: ChatSummary[] = [
  {
    id: 1,
    title: '文件传输助手',
    kind: 'private',
    unread: 0,
    pinned: true,
    muted: false,
    lastMessageText: '[图片] 设计稿 v3.png',
    lastMessageAt: now() - 180,
  },
  {
    id: 2,
    title: 'WechatGram 产品群',
    kind: 'group',
    unread: 12,
    pinned: true,
    muted: false,
    lastMessageText: '虚拟列表的滚动锚定我这边先接',
    lastMessageAt: now() - 540,
  },
  {
    id: 3,
    title: '妈',
    kind: 'private',
    unread: 1,
    pinned: false,
    muted: false,
    lastMessageText: '晚上回来吃饭吗',
    lastMessageAt: now() - 1500,
  },
  {
    id: 4,
    title: '前端周会',
    kind: 'group',
    unread: 3,
    pinned: false,
    muted: true,
    lastMessageText: '会议纪要已经放到共享盘',
    lastMessageAt: now() - 10800,
  },
  {
    id: 5,
    title: 'Telegram News',
    kind: 'channel',
    unread: 0,
    pinned: false,
    muted: false,
    lastMessageText: 'Telegram 11.0 released',
    lastMessageAt: now() - 36000,
  },
  {
    id: 99,
    title: '性能测试群 · 5000 条',
    kind: 'group',
    unread: 0,
    pinned: false,
    muted: true,
    lastMessageText: '压测消息 #5000：这是一条用于验证虚拟滚动与锚定补偿的中等长度消息。',
    lastMessageAt: now(),
  },
]

const perfMessages: Message[] = Array.from({ length: 5000 }, (_, index) => ({
  id: 10_000 + index,
  chatId: 99,
  senderId: index % 3 === 0 ? ME.id : 30 + (index % 5),
  senderName: index % 3 === 0 ? '我' : `成员${index % 5}`,
  outgoing: index % 3 === 0,
  date: now() - (600 - Math.floor(index / 10)) * 60,
  kind: 'text' as const,
  text: `压测消息 #${index + 1}：这是一条用于验证虚拟滚动与锚定补偿的中等长度消息。`,
}))

const messagesByChat: Record<number, Message[]> = {
  1: [
    msg(1, 101, '本周的设计稿放这里', false, 14_400),
    msg(1, 102, '收到，我晚点看', true, 14_340),
    msg(1, 103, '设计稿 v3.png', false, 240),
  ],
  2: [
    msg(2, 201, 'TDLib 的登录链路已经通了', false, 7_200),
    msg(2, 202, '那 UI 可以对着 mock 并行做', true, 7_080),
    msg(2, 203, '贴纸三种格式记得一起做，别留到二期', false, 1_800),
    msg(2, 204, '虚拟列表的滚动锚定我这边先接', false, 540),
  ],
  3: [
    msg(3, 301, '降温了，多穿点', false, 1_560),
    msg(3, 302, '晚上回来吃饭吗', false, 1_500),
  ],
  4: [msg(4, 401, '会议纪要已经放到共享盘', false, 10_800)],
  5: [
    msg(5, 501, 'Telegram 11.0 released', false, 36_000),
    // Channel post: sent by the chat itself, so senderId is 0 and senderChatId is set.
    {
      id: 502,
      chatId: 5,
      senderId: 0,
      senderChatId: 5,
      senderName: 'Telegram News',
      outgoing: false,
      date: now() - 36_000,
      kind: 'text',
      text: '频道消息：发送者是频道本身',
    },
  ],
  99: perfMessages,
}

const drafts: Record<number, string> = {}
const anchors: Record<number, { messageId: number; offset: number }> = {}

function msg(chatId: number, id: number, text: string, outgoing: boolean, secondsAgo: number): Message {
  return {
    id,
    chatId,
    senderId: outgoing ? ME.id : chatId * 10 + 7,
    senderName: outgoing ? '我' : '对方',
    outgoing,
    date: now() - secondsAgo,
    kind: 'text',
    text,
  }
}

let nextId = 9000
let proxy: ProxyConfig | null = null
let settings: AppSettings = { theme: 'light' }

const info: AppInfo = {
  version: '0.1.0',
  appVersion: '0.1.0-web',
  adapter: 'mock',
  userDataPath: '(browser preview)',
}

async function handle(channel: InvokeChannel, payload: unknown): Promise<unknown> {
  const store = payload as Record<string, any>

  switch (channel) {
    case 'app:info':
      return info
    case 'auth:state':
      return auth
    case 'auth:start':
      return setAuth({ kind: 'waitCode', hint: store.phone, codeLength: 5 })
    case 'auth:code': {
      if (store.code !== '12345') throw { code: 'auth_failed', message: '验证码是 12345' }
      return setAuth({ kind: 'waitPassword', hint: 'mock 密码 wechatgram' })
    }
    case 'auth:password': {
      if (store.password !== 'wechatgram') throw { code: 'auth_failed', message: '密码是 wechatgram' }
      const next: AuthState = { kind: 'ready', me: ME }
      setAuth(next)
      emit('evt:connection', 'online')
      return next
    }
    case 'auth:logout':
      emit('evt:connection', 'offline')
      setAuth({ kind: 'waitPhoneNumber' })
      return undefined
    case 'auth:me':
      return ME
    case 'chats:list':
      return chats
    case 'chats:get':
      return chats.find((chat) => chat.id === store.chatId)
    case 'chats:open': {
      const chat = chats.find((item) => item.id === store.chatId)
      if (chat) {
        chat.unread = 0
        emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
      }
      return undefined
    }
    case 'messages:history': {
      const all = messagesByChat[store.chatId] ?? []
      const fromId = store.fromMessageId as number | undefined
      const limit = Number(store.limit ?? 50)
      const older = fromId === undefined ? all : all.filter((item) => item.id < fromId)
      const page = older.slice(Math.max(0, older.length - limit))
      return { messages: page, hasMore: older.length > page.length }
    }
    case 'messages:send': {
      const list = messagesByChat[store.chatId] ?? []
      const message = msg(store.chatId, nextId++, String(store.text), true, 0)
      if (typeof store.replyTo === 'number') message.replyToId = store.replyTo
      list.push(message)
      messagesByChat[store.chatId] = list
      const chat = chats.find((item) => item.id === store.chatId)
      if (chat) {
        chat.lastMessageText = message.text
        chat.lastMessageAt = message.date
        emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
      }
      return { localId: `web-${message.id}`, message }
    }
    case 'messages:edit': {
      const list = messagesByChat[store.chatId] ?? []
      const target = list.find((item) => item.id === store.messageId)
      if (!target) throw { code: 'internal', message: 'message not found' }
      target.text = String(store.text)
      target.edited = true
      return target
    }
    case 'messages:delete': {
      const ids = store.messageIds as number[]
      messagesByChat[store.chatId] = (messagesByChat[store.chatId] ?? []).filter(
        (item) => !ids.includes(item.id),
      )
      return undefined
    }
    case 'messages:forward': {
      const ids = store.messageIds as number[]
      const source = messagesByChat[store.fromChatId] ?? []
      const target = messagesByChat[store.toChatId] ?? []
      for (const id of ids) {
        const original = source.find((item) => item.id === id)
        if (original) target.push({ ...original, id: nextId++, chatId: store.toChatId })
      }
      messagesByChat[store.toChatId] = target
      return undefined
    }
    case 'ui:getDraft': {
      const text = drafts[store.chatId]
      return text ? { text } : null
    }
    case 'ui:saveDraft': {
      const text = String(store.text ?? '')
      if (text.trim().length) drafts[store.chatId] = text
      else delete drafts[store.chatId]
      return undefined
    }
    case 'ui:getAnchor':
      return anchors[store.chatId] ?? null
    case 'ui:saveAnchor': {
      const messageId = store.messageId as number | null
      if (messageId === null) delete anchors[store.chatId]
      else anchors[store.chatId] = { messageId, offset: Number(store.offset ?? 0) }
      return undefined
    }
    case 'settings:get':
      return settings
    case 'settings:set': {
      const patch = store.patch as Partial<AppSettings>
      settings = { ...settings, ...patch }
      return undefined
    }
    case 'proxy:get':
      return proxy
    case 'proxy:set':
      proxy = (store.config as ProxyConfig | null) ?? null
      return undefined
    case 'proxy:test':
      return { ok: true, latencyMs: 3 } satisfies ProxyTestResult
    default:
      throw { code: 'not_implemented', message: `${channel} is not wired in the browser preview` }
  }
}

export function installPreviewBridge(): void {
  if (window.tg) return

  const bridge: TgBridge = {
    async invoke<C extends InvokeChannel>(
      channel: C,
      payload?: InvokeRequest<C>,
    ): Promise<InvokeResponse<C>> {
      return (await handle(channel, payload)) as InvokeResponse<C>
    },
    on<C extends EventChannel>(channel: C, callback: (event: EventEnvelope<C>) => void): () => void {
      const set = listeners.get(channel) ?? new Set()
      set.add(callback as (event: EventEnvelope<EventChannel>) => void)
      listeners.set(channel, set)
      return () => {
        set.delete(callback as (event: EventEnvelope<EventChannel>) => void)
      }
    },
  }

  window.tg = bridge
}
