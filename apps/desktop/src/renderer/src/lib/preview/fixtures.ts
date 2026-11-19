import type {
  AppInfo,
  ChatSummary,
  Contact,
  Message,
  MessageMedia,
  Self,
  Sticker,
  StickerSet,
} from '@wegram/protocol'

export const ME: Self = {
  id: 1000,
  firstName: '预览',
  lastName: '账号',
  username: 'preview',
  // The login window's profile step shows the account photo; a fixture gradient
  // keeps that path exercised in the browser.
  avatarUrl: svgUrl(160, 160, '#cfe8ff', '#f3c9a9'),
}

export const now = () => Math.floor(Date.now() / 1000)

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

export const chats: ChatSummary[] = [
  {
    id: 1,
    title: '文件传输助手',
    kind: 'private',
    // Saved Messages: a private chat that the 通讯录 must not list as a contact.
    userId: ME.id,
    unread: 0,
    pinned: true,
    muted: false,
    lastMessageText: '[图片] 两段素材一起发',
    lastMessageAt: now() - 60,
    lastReadInboxMessageId: 104,
    lastReadOutboxMessageId: 107,
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
    userId: 37,
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
  // Contacts the browser preview's 通讯录 shows: two Latin initials and one CJK
  // name, each with a 微信号 (the preview's `contactProfiles`).
  {
    id: 7,
    title: 'Ada Lovelace',
    kind: 'private',
    userId: 21,
    unread: 0,
    pinned: false,
    muted: false,
    lastMessageText: '明天图书馆见',
    lastMessageAt: now() - 900,
  },
  {
    id: 8,
    title: 'Ben Carter',
    kind: 'private',
    userId: 22,
    unread: 0,
    pinned: false,
    muted: false,
    lastMessageText: 'Thanks, that works!',
    lastMessageAt: now() - 2700,
  },
  {
    id: 9,
    title: '陈晨',
    kind: 'private',
    userId: 23,
    unread: 0,
    pinned: false,
    muted: false,
    lastMessageText: '周末一起吃个饭？',
    lastMessageAt: now() - 7200,
  },
  {
    id: 10,
    title: 'Dmitri Volkov',
    kind: 'private',
    userId: 24,
    unread: 0,
    pinned: false,
    muted: false,
    lastMessageText: 'Ок, договорились',
    lastMessageAt: now() - 14_400,
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
    id: 6,
    title: 'WeGram 频道',
    kind: 'channel',
    unread: 0,
    pinned: false,
    muted: false,
    lastMessageText: '其余频道只显示静音和只读提示',
    lastMessageAt: now() - 5400,
    lastReadInboxMessageId: 602,
    lastReadOutboxMessageId: 0,
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

export const messagesByChat: Record<number, Message[]> = {
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
    // One album: two messages that share an album id (design doc §8.6).
    {
      id: 106,
      chatId: 1,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: now() - 60,
      kind: 'photo',
      text: '两段素材一起发',
      albumId: '7401',
      media: media(8101, { width: 1200, height: 800, fileName: 'design-v3.png' }),
    },
    {
      id: 107,
      chatId: 1,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: now() - 60,
      kind: 'video',
      text: '',
      albumId: '7401',
      media: media(8102, { width: 720, height: 1280, mimeType: 'video/mp4', duration: 15 }),
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
  7: [msg(7, 701, '明天图书馆见', false, 900)],
  8: [msg(8, 801, 'Thanks, that works!', false, 2_700)],
  9: [msg(9, 901, '周末一起吃个饭？', false, 7_200)],
  10: [msg(10, 1001, 'Ок, договорились', false, 14_400)],
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
  6: [
    {
      id: 601,
      chatId: 6,
      senderId: 0,
      senderChatId: 6,
      senderName: 'WeGram 频道',
      outgoing: false,
      date: now() - 7200,
      kind: 'text',
      text: '这个频道由我管理：底栏有键盘按钮，可以直接发消息。',
    },
    {
      id: 602,
      chatId: 6,
      senderId: 0,
      senderChatId: 6,
      senderName: 'WeGram 频道',
      outgoing: false,
      date: now() - 5400,
      kind: 'text',
      text: '其余频道只显示静音和只读提示',
    },
  ],
  99: perfMessages,
}

export function msg(
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
export function previewFiles(): Record<number, string> {
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

export const PREVIEW_STICKERS: Sticker[] = [
  { fileId: 8001, format: 'webp', emoji: '😀', width: 128, height: 128, thumbFileId: 8001 },
  { fileId: 8002, format: 'tgs', emoji: '✨', width: 128, height: 128 },
]

export function previewStickerSet(): StickerSet {
  return {
    id: 'preview-stickers',
    title: 'WeGram 贴纸',
    ...(PREVIEW_STICKERS[0] ? { thumbnail: PREVIEW_STICKERS[0] } : {}),
    stickers: PREVIEW_STICKERS,
  }
}

export function media(fileId: number, extra: Partial<MessageMedia> = {}): MessageMedia {
  return {
    fileId,
    localUrl: previewFiles()[fileId],
    ...extra,
  }
}

/** Channels the preview account may post in (TDLib: an administrator right). */
export const channelPostRights: Record<number, boolean> = { 6: true }

/**
 * The browser preview's address book (`contacts:list`). A real account's
 * address book also holds people with no conversation at all; these four are
 * the preview's private-chat peers so 发消息 can open a transcript.
 */
export const contacts: Contact[] = [
  { userId: 21, title: 'Ada Lovelace', username: 'ada_lovelace' },
  { userId: 22, title: 'Ben Carter', username: 'ben_carter' },
  { userId: 23, title: '陈晨', username: 'chenchen' },
  { userId: 24, title: 'Dmitri Volkov', username: 'dvolkov' },
  { userId: 37, title: '妈', username: 'mama_wegram', phone: '+86 138 0000 0000' },
]

export const info: AppInfo = {
  version: __WEGRAM_VERSION__,
  appVersion: `${__WEGRAM_VERSION__}-web`,
  adapter: 'mock',
  userDataPath: '(browser preview)',
}
