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
  MessageMedia,
  ProxyConfig,
  ProxyTestResult,
  Self,
  Sticker,
  StickerSet,
  StickerSetSummary,
  TgBridge,
  ViewerItem,
} from '@wegram/protocol'

/**
 * Development-only bridge used when the renderer runs in a plain browser
 * (`pnpm web`). It mirrors just enough of the mock adapter to click through the
 * UI; the real source of truth is `main/telegram/mock.ts` + TDLib.
 *
 * Never install this when `window.tg` exists.
 */

const ME: Self = {
  id: 1000,
  firstName: '预览',
  lastName: '账号',
  username: 'preview',
  // The login window's profile step shows the account photo; a fixture gradient
  // keeps that path exercised in the browser.
  avatarUrl: svgUrl(160, 160, '#cfe8ff', '#f3c9a9'),
}

const now = () => Math.floor(Date.now() / 1000)

/** Gradient pairs for the preview's sender photos, picked by user id. */
const PREVIEW_AVATAR_COLORS: readonly (readonly [string, string])[] = [
  ['#4C9AFF', '#1B3C8C'],
  ['#7B61FF', '#3A2478'],
  ['#FF9F43', '#B4482A'],
  ['#2ED573', '#11704A'],
  ['#FF6B81', '#A02B48'],
  ['#00C2D1', '#0A5C70'],
  ['#B57BFF', '#4B2880'],
]

/** A face for a preview sender: transcript rows draw it like a real profile photo. */
function senderAvatar(userId: number): string {
  const pair = PREVIEW_AVATAR_COLORS[Math.abs(userId) % PREVIEW_AVATAR_COLORS.length] ??
    PREVIEW_AVATAR_COLORS[0] ?? ['#4C9AFF', '#1B3C8C']
  return svgUrl(96, 96, pair[0], pair[1])
}

/** A real gzip'd Lottie file, so the TGS path is exercised in the browser. */
const PREVIEW_TGS =
  'data:application/gzip;base64,H4sIAGBJ+2oC/6VT226DMAz9Fz9HyIxLKb8y8ZBxKxoUlrB2COXfZyfRGB172SSIybF9jh2HFW6QQxKcghgENAryCAV0E+RkRjJnsnfIw6dMwMXb60A5d3mrWyUHSquqysZLretZQ/5cCOjlUiv+Xr/c3ZVsKGBeII89i36jfK0s/krhK4y8SAfY9NkmM1WISMwdB3zQFoOYtgs7CiNcosNTj2NhjLAMceIoouSvDOdvRRiOVr8Xiv8ViVIvMnkRdCJpLOhB9si9BwU6XO9xKlf4l1VAX+RUu7nwHKBVNIBu3gBV8kRtW/pA/KAoL6x2aJgZP2JVlzPY/pi+6Ym+fCAIMBIYnFJaokxsx7SxITqF0JM2Xd9vpDM3cVyVPESPD+lnF3hYiSl8Fa0a3yfg7cMfo91deBmYojCfs22fcmYDAAA='

let seq = 0
const listeners = new Map<string, Set<(event: EventEnvelope<EventChannel>) => void>>()

function emit(channel: EventChannel, payload: unknown): void {
  seq += 1
  const envelope = { seq, payload } as EventEnvelope<EventChannel>
  for (const listener of listeners.get(channel) ?? []) listener(envelope)
}

/**
 * The shell is the default browser-preview route. `#login` previews the login
 * window, which must start signed out so the phone form (not the profile step)
 * is what you land on.
 */
let auth: AuthState = window.location.hash.startsWith('#login')
  ? { kind: 'waitPhoneNumber' }
  : { kind: 'ready', me: ME }

function setAuth(next: AuthState): AuthState {
  auth = next
  emit('evt:auth', next)
  return next
}

/** Fake QR confirmation; the mock adapter does the same in the main process. */
let qrTimer: number | null = null

function clearQrTimer(): void {
  if (qrTimer !== null) window.clearTimeout(qrTimer)
  qrTimer = null
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
    lastReadInboxMessageId: 104,
    lastReadOutboxMessageId: 103,
  },
  {
    id: 2,
    title: 'WeGram 产品群',
    kind: 'group',
    unread: 12,
    pinned: true,
    muted: false,
    lastMessageText: '[贴纸] ✨',
    lastMessageAt: now() - 60,
    lastReadInboxMessageId: 204,
    lastReadOutboxMessageId: 202,
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

const perfMessages: Message[] = Array.from({ length: 5000 }, (_, index) => {
  const outgoing = index % 3 === 0
  const senderId = outgoing ? ME.id : 30 + (index % 5)
  return {
    id: 10_000 + index,
    chatId: 99,
    senderId,
    senderName: outgoing ? '我' : `成员${index % 5}`,
    ...(outgoing ? {} : { senderAvatarUrl: senderAvatar(senderId) }),
    outgoing,
    date: now() - (600 - Math.floor(index / 10)) * 60,
    kind: 'text' as const,
    text: `压测消息 #${index + 1}：这是一条用于验证虚拟滚动与锚定补偿的中等长度消息。`,
  }
})

const messagesByChat: Record<number, Message[]> = {
  1: [
    msg(1, 101, '本周的设计稿放这里', false, 14_400),
    msg(1, 102, '收到，我晚点看', true, 14_340),
    {
      id: 103,
      chatId: 1,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: now() - 360,
      kind: 'photo',
      text: '设计稿 v3，先看这个方向',
      media: media(8101, { width: 1200, height: 800, fileName: 'design-v3.png' }),
    },
    {
      id: 104,
      chatId: 1,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: now() - 300,
      kind: 'file',
      text: '',
      media: media(8201, { fileName: '需求说明.md', size: 2048, mimeType: 'text/markdown' }),
    },
    {
      id: 105,
      chatId: 1,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: now() - 180,
      kind: 'sticker',
      text: '',
      media: media(8001, { stickerFormat: 'webp', stickerEmoji: '😀', width: 128, height: 128 }),
    },
  ],
  2: [
    msg(2, 201, 'TDLib 的登录链路已经通了', false, 7_200),
    msg(2, 202, '那 UI 可以对着 mock 并行做', true, 7_080),
    msg(2, 203, '贴纸三种格式记得一起做，别留到二期', false, 1_800),
    msg(2, 204, '虚拟列表的滚动锚定我这边先接', false, 540),
    {
      id: 205,
      chatId: 2,
      senderId: 27,
      senderName: '成员2',
      senderAvatarUrl: senderAvatar(27),
      outgoing: false,
      date: now() - 240,
      kind: 'photo',
      text: '截个图给你',
      media: media(8102, { width: 900, height: 1200, fileName: 'sunset.png' }),
    },
    {
      id: 206,
      chatId: 2,
      senderId: 27,
      senderName: '成员2',
      senderAvatarUrl: senderAvatar(27),
      outgoing: false,
      date: now() - 150,
      kind: 'sticker',
      text: '',
      media: media(8001, { stickerFormat: 'webp', stickerEmoji: '😀', width: 128, height: 128 }),
    },
    {
      id: 207,
      chatId: 2,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: now() - 60,
      kind: 'sticker',
      text: '',
      media: media(8002, { stickerFormat: 'tgs', stickerEmoji: '✨', width: 128, height: 128 }),
    },
  ],
  3: [msg(3, 301, '降温了，多穿点', false, 1_560), msg(3, 302, '晚上回来吃饭吗', false, 1_500)],
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

/**
 * The adapter's read rule in three lines: the marker only moves forward, and
 * `unread` is whatever is still newer than it. `upTo === null` means "the newest
 * message" (`chats:open`).
 */
function applyPreviewRead(chatId: number, upTo: number | null): void {
  const chat = chats.find((item) => item.id === chatId)
  if (!chat) return
  const list = messagesByChat[chatId] ?? []
  const marker = upTo ?? list[list.length - 1]?.id ?? null
  if (marker !== null) chat.lastReadInboxMessageId = marker
  chat.unread = list.filter(
    (message) => !message.outgoing && message.id > (chat.lastReadInboxMessageId ?? 0),
  ).length
  emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
}

const drafts: Record<number, string> = {}
const anchors: Record<number, { messageId: number; offset: number }> = {}

function msg(
  chatId: number,
  id: number,
  text: string,
  outgoing: boolean,
  secondsAgo: number,
): Message {
  const senderId = outgoing ? ME.id : chatId * 10 + 7
  return {
    id,
    chatId,
    senderId,
    senderName: outgoing ? '我' : '对方',
    // Our own rows draw the rail's photo from `auth.me`, everybody else's from
    // the row itself (the real adapter pushes late ones through `evt:avatars`).
    ...(senderId === ME.id ? {} : { senderAvatarUrl: senderAvatar(senderId) }),
    outgoing,
    date: now() - secondsAgo,
    kind: 'text',
    text,
  }
}

/* ---------- preview-only media ---------- */

function svgUrl(width: number, height: number, from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <circle cx="${width * 0.7}" cy="${height * 0.34}" r="${Math.min(width, height) * 0.16}" fill="rgba(255,255,255,0.55)"/>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function stickerSvg(emoji: string, background: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
    <rect x="4" y="4" width="120" height="120" rx="26" fill="${background}"/>
    <text x="64" y="86" font-size="64" text-anchor="middle">${emoji}</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Built lazily and memoised on `globalThis`: the fixture message table below is
 * initialised at module load, before these declarations would have run, so it
 * must not touch them eagerly (a module-level `let` would be in its TDZ).
 */
function previewFiles(): Record<number, string> {
  const store = globalThis as typeof globalThis & { __wxPreviewFiles?: Record<number, string> }
  store.__wxPreviewFiles ??= {
    8001: stickerSvg('😀', '#FFD75E'),
    8002: PREVIEW_TGS,
    8101: svgUrl(1200, 800, '#22427c', '#eca860'),
    8102: svgUrl(900, 1200, '#faaa46', '#5a1e6e'),
    8201: 'data:text/markdown;utf8,%23%20%E9%9C%80%E6%B1%82%E8%AF%B4%E6%98%8E%0A%0A-%20%E5%AA%92%E4%BD%93%E6%94%B6%E5%8F%91',
  }
  return store.__wxPreviewFiles
}

const PREVIEW_STICKERS: Sticker[] = [
  { fileId: 8001, format: 'webp', emoji: '😀', width: 128, height: 128, thumbFileId: 8001 },
  { fileId: 8002, format: 'tgs', emoji: '✨', width: 128, height: 128 },
]

function previewStickerSet(): StickerSet {
  return {
    id: 'preview-stickers',
    title: 'WeGram 贴纸',
    ...(PREVIEW_STICKERS[0] ? { thumbnail: PREVIEW_STICKERS[0] } : {}),
    stickers: PREVIEW_STICKERS,
  }
}

function media(fileId: number, extra: Partial<MessageMedia> = {}): MessageMedia {
  return {
    fileId,
    localUrl: previewFiles()[fileId],
    ...extra,
  }
}

let nextId = 9000
/** The chat the UI last opened; the dev injector below delivers arrivals into it. */
let openChatId: number | null = null
let proxy: ProxyConfig | null = null
let settings: AppSettings = { theme: 'light' }
let previewViewer: { items: ViewerItem[]; index: number; title?: string } | null = null

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
      return setAuth({ kind: 'waitPassword', hint: 'mock 密码 wegram' })
    }
    case 'auth:password': {
      if (store.password !== 'wegram') throw { code: 'auth_failed', message: '密码是 wegram' }
      clearQrTimer()
      const next: AuthState = { kind: 'ready', me: ME }
      setAuth(next)
      emit('evt:connection', 'online')
      return next
    }
    case 'auth:qr': {
      if (auth.kind !== 'waitPhoneNumber') return auth
      const next = setAuth({
        kind: 'waitQr',
        link: `tg://login?token=preview-${Math.random().toString(36).slice(2, 10)}`,
      })
      clearQrTimer()
      qrTimer = window.setTimeout(() => {
        qrTimer = null
        setAuth({ kind: 'ready', me: ME })
        emit('evt:connection', 'online')
      }, 10_000)
      return next
    }
    case 'auth:reset':
      clearQrTimer()
      return setAuth({ kind: 'waitPhoneNumber' })
    case 'auth:logout':
      clearQrTimer()
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
      // Reading is reported per viewport via `messages:read`; opening a chat must
      // not mark it read (same rule as the real adapter, see tdlib/actions.ts).
      openChatId = Number(store.chatId)
      return undefined
    }
    case 'messages:read': {
      const upTo = Number(store.upToMessageId)
      if (Number.isFinite(upTo)) applyPreviewRead(Number(store.chatId), upTo)
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
    case 'messages:sendSticker': {
      const sticker = PREVIEW_STICKERS.find((item) => item.fileId === store.fileId)
      if (!sticker) throw { code: 'internal', message: 'unknown sticker' }
      const list = messagesByChat[store.chatId] ?? []
      const message: Message = {
        id: nextId++,
        chatId: store.chatId,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: now(),
        kind: 'sticker',
        text: '',
        media: media(sticker.fileId, {
          stickerFormat: sticker.format,
          ...(sticker.emoji ? { stickerEmoji: sticker.emoji } : {}),
          ...(sticker.width ? { width: sticker.width } : {}),
          ...(sticker.height ? { height: sticker.height } : {}),
        }),
      }
      list.push(message)
      messagesByChat[store.chatId] = list
      return { localId: `web-${message.id}`, message }
    }
    case 'media:pick':
      // The browser cannot hand us a local path; sending files needs Electron.
      return { paths: [] }
    case 'media:download': {
      const url = previewFiles()[Number(store.fileId)]
      if (!url) throw { code: 'internal', message: 'unknown preview file' }
      return { path: url, url }
    }
    case 'media:open': {
      const url = previewFiles()[Number(store.fileId)]
      if (url) window.open(url, '_blank', 'noopener')
      return undefined
    }
    case 'media:send':
      throw { code: 'not_implemented', message: '浏览器预览不能发送本地文件' }
    case 'stickers:sets': {
      const set = previewStickerSet()
      return [
        { id: set.id, title: set.title, ...(set.thumbnail ? { thumbnail: set.thumbnail } : {}) },
      ] satisfies StickerSetSummary[]
    }
    case 'stickers:set':
      return previewStickerSet()
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
    /**
     * The viewer is its own Electron window, so the browser preview can only
     * record the request (a photo or video click is a no-op there).
     */
    case 'viewer:open':
      previewViewer = payload as { items: ViewerItem[]; index: number; title?: string }
      return undefined
    case 'viewer:init':
      if (!previewViewer) throw { code: 'internal', message: '查看器还没有打开' }
      return { items: previewViewer.items, index: previewViewer.index, theme: settings.theme }
    case 'viewer:save':
    case 'viewer:copy':
    case 'viewer:reveal':
      throw { code: 'not_implemented', message: '浏览器预览不能访问本地文件' }
    case 'viewer:pin':
      return { onTop: false }
    case 'viewer:close':
      return undefined
    /**
     * Window hand-over is Electron main's job. In the browser preview the
     * "windows" are routes, so these two are no-ops.
     */
    case 'login:enter':
    case 'login:close':
      return undefined
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
    on<C extends EventChannel>(
      channel: C,
      callback: (event: EventEnvelope<C>) => void,
    ): () => void {
      const set = listeners.get(channel) ?? new Set()
      set.add(callback as (event: EventEnvelope<EventChannel>) => void)
      listeners.set(channel, set)
      return () => {
        set.delete(callback as (event: EventEnvelope<EventChannel>) => void)
      }
    },
  }

  window.tg = bridge

  /**
   * Dev-only arrival injector for the browser preview.
   *
   * The mock adapter's traffic is random (one chat every 12 s) and never lands in
   * the 5000-message fixture, the only chat tall enough to scroll up in — so
   * arrival behaviour (the buoy's count, unread badges, auto-scroll) could not be
   * exercised on demand. Console: `__wxPreviewIncoming('文案')`.
   */
  const previewWindow: Window & { __wxPreviewIncoming?: (text?: string) => void } = window
  previewWindow.__wxPreviewIncoming = (text = '预览：新消息') => {
    if (openChatId === null) return
    const chatId = openChatId
    const message = msg(chatId, nextId++, text, false, 0)
    messagesByChat[chatId] = [...(messagesByChat[chatId] ?? []), message]
    emit('evt:messages', { chatId, ops: [{ op: 'new', message }] })
    // Mirror the adapter: an incoming message also bumps the chat's unread count,
    // which is what the row badge and the rail total read.
    const chat = chats.find((item) => item.id === chatId)
    if (chat) {
      chat.unread += 1
      chat.lastMessageText = message.text
      chat.lastMessageAt = message.date
      emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
    }
  }
}
