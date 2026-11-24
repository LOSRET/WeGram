import { buildFixtureSeeds, DEMO_STICKER_SET_ID } from '@wegram/mock-fixtures'
import { sortChatList } from '@wegram/mock-session'
import type { FakeCommentFlags } from '@wegram/mock-session'

import type { PreviewPerson } from './profile'
import type {
  AppInfo,
  ChatSummary,
  ChatTopic,
  Contact,
  CustomEmojiSticker,
  Message,
  MessageMedia,
  Self,
  Sticker,
  StickerSet,
  StickerSetSummary,
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

/** Gradient pairs for the preview's photos, picked by chat or user id. */
const PREVIEW_AVATAR_COLORS: readonly (readonly [string, string])[] = [
  ['#4C9AFF', '#1B3C8C'],
  ['#7B61FF', '#3A2478'],
  ['#FF9F43', '#B4482A'],
  ['#2ED573', '#11704A'],
  ['#FF6B81', '#A02B48'],
  ['#00C2D1', '#0A5C70'],
  ['#B57BFF', '#4B2880'],
]

/** A face for a preview chat or sender: rows draw it like a real photo. */
function face(id: number): string {
  const pair = PREVIEW_AVATAR_COLORS[Math.abs(id) % PREVIEW_AVATAR_COLORS.length] ??
    PREVIEW_AVATAR_COLORS[0] ?? ['#4C9AFF', '#1B3C8C']
  return svgUrl(96, 96, pair[0], pair[1])
}

/** A real gzip'd Lottie file, so the TGS path is exercised in the browser. */
const PREVIEW_TGS =
  'data:application/gzip;base64,H4sIAGBJ+2oC/6VT226DMAz9Fz9HyIxLKb8y8ZBxKxoUlrB2COXfZyfRGB172SSIybF9jh2HFW6QQxKcghgENAryCAV0E+RkRjJnsnfIw6dMwMXb60A5d3mrWyUHSquqysZLretZQ/5cCOjlUiv+Xr/c3ZVsKGBeII89i36jfK0s/krhK4y8SAfY9NkmM1WISMwdB3zQFoOYtgs7CiNcosNTj2NhjLAMceIoouSvDOdvRRiOVr8Xiv8ViVIvMnkRdCJpLOhB9si9BwU6XO9xKlf4l1VAX+RUu7nwHKBVNIBu3gBV8kRtW/pA/KAoL6x2aJgZP2JVlzPY/pi+6Ym+fCAIMBIYnFJaokxsx7SxITqF0JM2Xd9vpDM3cVyVPESPD+lnF3hYiSl8Fa0a3yfg7cMfo91deBmYojCfs22fcmYDAAA='

/**
 * The premium sticker's effect, as a data URL: the same gzip'd Lottie file the
 * mock writes to `premium-sticker-effect.tgs` (packages/mock-adapter/src/mock-assets.ts,
 * generated there once). Duplicated instead of shared because the mock owns real
 * files and the preview owns URLs — the account data only names file ids.
 */
const PREVIEW_PREMIUM_EFFECT =
  'data:application/gzip;base64,H4sIAAAAAAACCu2ZbY+bMAyA/4s/e8gh4aX5Kyc+cC3coSstCty2quK/nxLoVe1lEmWatGX+kLbYxHZenprgM3wHDUmURQoQagNaEkLTgSaEYwda5Qg/QCciRnidvw8taOhM1Tbv7beqrqvtAAi73c71Kvu+GnrQTwXCvjxVxv4+f6qbww60QBhOoNVsq+9K80aA0Bune+tBn+FoP8pJ4EwMzoA1RwVCY9U/7UWkCoQT6CdRjDh1m+TpLKdiHNH1z6b+glZbUPElhNHea/5AkHbOXZTJ7KSbndDkRKUK4yRFsrryVkdIk7y/lQsinJv1A/1r2VXTytiVgBcD82K8mON7BwjNcNWarV1gN8o7u1KhVJ4Y5yjMjXQzzj6M3TJutNZ6vQeE7V28SFGeIEUKrxP2qRZEk3ExG6yb/f5qcLCD8QdUeqX+yfo6APpFJC6GwZSHvj6aFsZiLL5Q1E8747l1Zu6AiD1ACAZiKRAk0TYGIhggpAeImIFYCITNDjZLMBDBAKE8QEgGYiEQgjacIcICIvEAoRiIpY9MOR8hwuIh9fCQMA8PJAjbGIhggMg8QKQMxCNHiJx5CIeH3MNDxjw88I6JE0RQQGzWViHS39xrQoZARELpX3OGEDmKfCkRyWNEbFKkKMv/CyQErS1EMBPunzkXqDLJTITEhFhbi2Am3IpJZiI4JuK15QhmwjrhJ6fgiJBr6xFMxCVLyA0jERISam1JgpG4HCYYiX8aiWL8ACY4TQJiKwAA'

/**
 * The preview's media, keyed by the *same* file ids the mock's assets use.
 *
 * The account data is shared; only the bytes differ — the mock materialises real
 * PNG/WebP/TGS/WebM files, the browser gets SVG and data URLs so the same rows,
 * stickers and progress paths render without a protocol handler.
 */
/**
 * The animated emoji's click sound, as a data URL: the same 0.18 s 880 Hz beep the
 * mock writes under userData (packages/mock-adapter/src/mock-assets.ts). The browser preview has
 * no `wx-media://` handler, so the WAV travels inside the URL — `media-src` allows
 * `data:`, and `new Audio(url)` plays it exactly like the Electron path.
 */
function beepWav(): string {
  const sampleRate = 22_050
  const samples = Math.round(sampleRate * 0.18)
  const pcmBytes = samples * 2
  const buffer = new ArrayBuffer(44 + pcmBytes)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, pcmBytes, true)
  for (let index = 0; index < samples; index += 1) {
    // Fade the edges so the click does not start or end with a pop.
    const fade = Math.min(1, Math.min(index, samples - index) / (sampleRate * 0.01))
    const wave = Math.sin((2 * Math.PI * 880 * index) / sampleRate)
    view.setInt16(44 + index * 2, Math.round(wave * fade * 0.25 * 32_767), true)
  }
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return 'data:audio/wav;base64,' + btoa(binary)
}

export function previewFiles(): Record<number, string> {
  const store = globalThis as typeof globalThis & { __wxPreviewFiles?: Record<number, string> }
  store.__wxPreviewFiles ??= {
    7001: stickerSvg('😀', '#FFD75E'),
    7002: stickerSvg('❤️', '#FF9F43'),
    7003: PREVIEW_TGS,
    7004: beepWav(),
    // The TGS sticker's still frame (its resting state in a grid).
    7006: stickerSvg('✨', '#7ED6A5'),
    // The premium sticker's effect (§8.5): a second file, fetched lazily.
    7005: PREVIEW_PREMIUM_EFFECT,
    7101: svgUrl(1200, 800, '#22427c', '#eca860'),
    7102: svgUrl(900, 1200, '#faaa46', '#5a1e6e'),
    7201: 'data:text/markdown;utf8,%23%20%E9%9C%80%E6%B1%82%E8%AF%B4%E6%98%8E%0A%0A-%20%E5%AA%92%E4%BD%93%E6%94%B6%E5%8F%91',
    // A poster placeholder: the browser preview has no WebM fixture, and the
    // video bubble opens the viewer rather than playing inline anyway.
    7301: svgUrl(720, 1280, '#2b2b2b', '#6e1a4a'),
  }
  return store.__wxPreviewFiles
}

export function media(fileId: number, extra: Partial<MessageMedia> = {}): MessageMedia {
  return {
    fileId,
    localUrl: previewFiles()[fileId],
    ...extra,
  }
}

/* ---------- the shared account, decorated for the browser ---------- */

const seeds = buildFixtureSeeds({ selfId: ME.id, mediaOf: media, now })

/**
 * The preview draws profile photos the mock gets from `evt:avatars`; a gradient
 * here keeps the photo path (row avatar, comment avatar) exercised in a browser.
 */
function decorate(message: Message): Message {
  if (message.outgoing) return message
  const from = message.senderChatId ?? message.senderId
  return from > 0 ? { ...message, senderAvatarUrl: face(from) } : message
}

export const chats: ChatSummary[] = sortChatList(
  [...seeds.values()].map((seed) => ({ ...seed.chat, avatarUrl: face(seed.chat.id) })),
)

export const messagesByChat: Record<number, Message[]> = {}
/** 话题 (design doc §9.12): the shared seed's forum topics, mutable per session. */
export const topicsByChat: Record<number, ChatTopic[]> = {}
export const previewThreads: Record<string, Message[]> = {}
export const previewCommentAccess: Record<string, FakeCommentFlags> = {}

export const channelPostRights: Record<number, boolean> = {}

/**
 * Channels this account has not subscribed to: one reached from 搜索 is only
 * being previewed, so the bottom bar offers 加入 (design doc §9.9). Joining
 * removes the id — the preview needs no other membership state.
 */
export const channelNotJoined = new Set<number>()

for (const seed of seeds.values()) {
  messagesByChat[seed.chat.id] = seed.messages.map(decorate)
  if (seed.topics) topicsByChat[seed.chat.id] = seed.topics.map((topic) => ({ ...topic }))
  if (seed.canPost) channelPostRights[seed.chat.id] = true
  if (seed.chat.kind === 'channel' && seed.joined === false) channelNotJoined.add(seed.chat.id)
  for (const [messageId, thread] of Object.entries(seed.comments ?? {})) {
    const key = seed.chat.id + ':' + messageId
    previewThreads[key] = thread.map(decorate)
    if (seed.commentAccess) previewCommentAccess[key] = seed.commentAccess
  }
}

/**
 * 共同群聊 for one person: the group chats the seed says they share with the
 * account. The mock adapter reads the same `commonChatIds`, so the two fakes
 * cannot disagree about a card.
 */
/**
 * The commands the chat's fixture bot publishes, for the composer's "/" list.
 * The mock adapter reads the same seed, so the two fakes cannot disagree.
 */
export function previewBotCommands(chatId: number): {
  isBot: boolean
  commands: Array<{ command: string; description: string }>
} {
  for (const seed of seeds.values()) {
    if (seed.chat.id !== chatId) continue
    return seed.bot ? { isBot: true, commands: seed.bot.commands } : { isBot: false, commands: [] }
  }
  return { isBot: false, commands: [] }
}

/**
 * The person behind a 资料卡: the seed's identity, 简介 and 备注, plus a bot's
 * `bot_info` stand-in. The mock adapter reads the same seed fields, so the two
 * fakes cannot disagree about a card.
 */
export function previewPersonFor(userId: number): PreviewPerson | null {
  for (const seed of seeds.values()) {
    if (seed.chat.userId !== userId) continue
    const { chat, contact, bot } = seed
    return {
      userId,
      title: chat.title,
      ...(contact?.username ? { username: contact.username } : {}),
      ...(contact?.phone ? { phone: contact.phone } : {}),
      ...(chat.avatarUrl ? { avatarUrl: chat.avatarUrl } : {}),
      ...(contact?.bio ? { bio: contact.bio } : {}),
      ...(contact?.note ? { note: contact.note } : {}),
      ...(bot ? { bot } : {}),
    }
  }
  return null
}

/**
 * The fixture bot's @username, or an empty string when the seed carries none.
 * The inline picker is addressed by handle, so the preview needs it (§8.3).
 */
export function previewBotUsername(): string {
  for (const seed of seeds.values()) {
    const username = seed.bot?.username?.trim().toLowerCase()
    if (username) return username
  }
  return ''
}

/**
 * 添加成员 (§8.3): the fixture person or bot behind an @username, or null. The
 * preview resolves the same handles the mock adapter does, so the two cannot
 * disagree about who can be added.
 */
export function previewMemberByUsername(
  username: string,
): { userId: number; title: string } | null {
  const handle = username.trim().replace(/^@+/, '').toLowerCase()
  if (!handle) return null
  for (const seed of seeds.values()) {
    const userId = seed.chat.userId
    if (!userId || seed.chat.kind !== 'private') continue
    const person = seed.contact?.username?.toLowerCase() === handle
    const bot = seed.bot?.username?.toLowerCase() === handle
    if (person || bot) return { userId, title: seed.chat.title }
  }
  return null
}

export function previewCommonChatsFor(userId: number): ChatSummary[] {
  for (const seed of seeds.values()) {
    if (seed.chat.userId !== userId) continue
    return (seed.commonChatIds ?? []).flatMap((id) => {
      const chat = chats.find((item) => item.id === id)
      return chat?.kind === 'group' ? [{ ...chat }] : []
    })
  }
  return []
}

/** The address book: every private seed that is a person, not Saved Messages or a bot. */
export const contacts: Contact[] = [...seeds.values()]
  .flatMap((seed) => {
    const userId = seed.chat.userId
    if (seed.chat.kind !== 'private' || userId === undefined || userId === ME.id) return []
    // A bot is not an address-book contact (TDLib's getContacts agrees).
    if (seed.bot) return []
    return [
      {
        userId,
        title: seed.chat.title,
        ...(seed.contact?.username ? { username: seed.contact.username } : {}),
        ...(seed.contact?.phone ? { phone: seed.contact.phone } : {}),
        ...(seed.contact?.dcId ? { dcId: seed.contact.dcId } : {}),
      },
    ]
  })
  .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))

/** One live arrival, injected from the console (`__wxPreviewIncoming`). */
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
    ...(outgoing ? {} : { senderAvatarUrl: face(senderId) }),
    outgoing,
    date: now() - secondsAgo,
    kind: 'text',
    text,
  }
}

/* ---------- preview-only artwork ---------- */

function svgUrl(width: number, height: number, from: string, to: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' +
    from +
    '"/><stop offset="1" stop-color="' +
    to +
    '"/></linearGradient></defs><rect width="' +
    width +
    '" height="' +
    height +
    '" fill="url(#g)"/></svg>'
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

function stickerSvg(emoji: string, background: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect x="4" y="4" width="120" height="120" rx="26" fill="' +
    background +
    '"/><text x="64" y="86" font-size="64" text-anchor="middle">' +
    emoji +
    '</text></svg>'
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

export const PREVIEW_STICKERS: Sticker[] = [
  { fileId: 7001, format: 'webp', emoji: '😀', width: 128, height: 128, thumbFileId: 7001 },
  { fileId: 7002, format: 'webp', emoji: '❤️', width: 128, height: 128, thumbFileId: 7002 },
  {
    fileId: 7003,
    format: 'tgs',
    emoji: '✨',
    width: 128,
    height: 128,
    // TDLib always ships a static picture for an animated sticker; the fixture
    // does too, so a grid cell has a still frame before it is hovered.
    thumbFileId: 7006,
    thumbFormat: 'webp',
  },
]

/**
 * Custom emoji art by entity id. The fixture uses one `customEmoji` entity whose
 * id is the ✨ TGS sticker's own file id; the preview answers it like TDLib would.
 */
export function previewCustomEmoji(ids: string[]): CustomEmojiSticker[] {
  return ids.flatMap((customEmojiId) => {
    const sticker = PREVIEW_STICKERS.find((item) => String(item.fileId) === customEmojiId)
    return sticker ? [{ customEmojiId, sticker }] : []
  })
}

/**
 * The preview pack's install flags, so the pack page's 移除 / 归档 are clickable
 * in the browser. Reset on reload, like the rest of the preview session.
 */
const stickerSetState = { installed: true, archived: false }
// The shared dataset tags its sticker rows with this id, so the browser preview
// resolves the same pack the clicks name.
const PREVIEW_STICKER_SET_ID = DEMO_STICKER_SET_ID

export function previewStickerSet(): StickerSet {
  return {
    id: PREVIEW_STICKER_SET_ID,
    title: 'WeGram 贴纸 @preview',
    name: 'wegram',
    isInstalled: stickerSetState.installed,
    isArchived: stickerSetState.archived,
    ...(PREVIEW_STICKERS[0] ? { thumbnail: PREVIEW_STICKERS[0] } : {}),
    stickers: PREVIEW_STICKERS,
  }
}

/** The installed list the tab strip draws; an archived or removed pack is gone. */
export function previewStickerSets(): StickerSetSummary[] {
  if (!stickerSetState.installed || stickerSetState.archived) return []
  const set = previewStickerSet()
  return [{ id: set.id, title: set.title, ...(set.thumbnail ? { thumbnail: set.thumbnail } : {}) }]
}

/** 移除贴纸包 / 归档贴纸 / 安装, the same flags the real adapter writes. */
export function previewChangeStickerSet(
  setId: string,
  change: { installed: boolean; archived?: boolean },
): void {
  if (setId !== PREVIEW_STICKER_SET_ID) {
    throw { code: 'internal', message: `Unknown sticker set ${setId}` }
  }
  if (!change.installed) {
    stickerSetState.installed = false
    stickerSetState.archived = false
    return
  }
  stickerSetState.installed = true
  stickerSetState.archived = change.archived === true
}

export const info: AppInfo = {
  version: __WEGRAM_VERSION__,
  appVersion: __WEGRAM_VERSION__ + '-web',
  adapter: 'mock',
  userDataPath: '(browser preview)',
}
