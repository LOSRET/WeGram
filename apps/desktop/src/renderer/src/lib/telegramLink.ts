/**
 * Telegram's own links as in-app destinations (design doc §8.3).
 *
 * A message may contain `https://t.me/…` or `tg://…`, and Telegram's clients read
 * those as "open this chat / this post" instead of leaving the app. Parsing lives
 * here, free of IPC and React, so every form the official clients emit is pinned by
 * a unit test and the click path only has to open the target.
 *
 * Invite links (`t.me/+hash`, `t.me/joinchat/…`) and the non-message pages
 * (`/addstickers`, `/share`, `/proxy`…) deliberately answer `null`: this client
 * cannot join a group from a link, so those keep the shell's external-link policy.
 */
export type TelegramLinkTarget =
  | { kind: 'username'; username: string; messageId?: number }
  | { kind: 'user'; userId: number }
  | { kind: 'chat'; chatId: number; messageId?: number }

/** Every hostname Telegram hands out for public links. */
const TELEGRAM_HOSTS = new Set([
  't.me',
  'www.t.me',
  'telegram.me',
  'www.telegram.me',
  'telegram.dog',
  'www.telegram.dog',
])

/** Telegram usernames: ASCII letters, digits and underscores. */
const USERNAME = /^[A-Za-z0-9_]+$/

/**
 * A supergroup's public "internal" id (the number in `t.me/c/<id>`) becomes its
 * TDLib chat id by this offset: chat ids are `-1000000000000 - supergroup_id`.
 */
const SUPERGROUP_CHAT_ID_BASE = 1_000_000_000_000

/** Path words that name a Telegram website page or an action, not a chat. */
const NOT_A_CHAT = new Set([
  'addemoji',
  'addstickers',
  'contact',
  'iv',
  'joinchat',
  'login',
  'proxy',
  'setlanguage',
  'share',
  'socks',
  'stats',
])

export function telegramLinkTarget(href: string | undefined): TelegramLinkTarget | null {
  if (!href) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    return TELEGRAM_HOSTS.has(url.hostname.toLowerCase()) ? fromPath(url) : null
  }
  return url.protocol === 'tg:' ? fromTg(url) : null
}

/** `t.me` paths: `/<username>[/<post>]`, `/s/<username>[/<post>]`, `/c/<id>[/<post>]`. */
function fromPath(url: URL): TelegramLinkTarget | null {
  const parts = url.pathname.split('/').filter((part) => part !== '')
  const head = parts[0]
  if (head === undefined) return null
  // `t.me/s/<name>` is the public web preview of the same channel.
  const [name, ...rest] = head === 's' ? parts.slice(1) : parts

  if (name === 'c') {
    const chatId = internalChatId(rest[0])
    if (chatId === null) return null
    const messageId = positiveInt(rest[1])
    if (rest.length > 1 && messageId === null) return null
    return messageId === null ? { kind: 'chat', chatId } : { kind: 'chat', chatId, messageId }
  }
  if (name === undefined || name.startsWith('+') || NOT_A_CHAT.has(name)) return null
  if (!USERNAME.test(name)) return null
  const messageId = positiveInt(rest[0])
  if (rest.length > 0 && messageId === null) return null
  return messageId === null
    ? { kind: 'username', username: name }
    : { kind: 'username', username: name, messageId }
}

/** `tg://` actions the official clients emit: resolve, user and openmessage. */
function fromTg(url: URL): TelegramLinkTarget | null {
  const action = url.hostname.toLowerCase()
  if (action === 'resolve') {
    const username = url.searchParams.get('domain') ?? ''
    if (!USERNAME.test(username)) return null
    const messageId = positiveInt(url.searchParams.get('post'))
    return messageId === null
      ? { kind: 'username', username }
      : { kind: 'username', username, messageId }
  }
  if (action === 'user') {
    const userId = positiveInt(url.searchParams.get('id'))
    return userId === null ? null : { kind: 'user', userId }
  }
  if (action === 'openmessage') {
    const chatId = integer(url.searchParams.get('chat_id'))
    if (chatId === null || chatId === 0) return null
    // A private chat's id is the user id; TDLib opens it with createPrivateChat.
    if (chatId > 0) return { kind: 'user', userId: chatId }
    const messageId = positiveInt(url.searchParams.get('message_id'))
    return messageId === null ? { kind: 'chat', chatId } : { kind: 'chat', chatId, messageId }
  }
  return null
}

function internalChatId(value: string | undefined): number | null {
  const internal = positiveInt(value)
  if (internal === null) return null
  const chatId = SUPERGROUP_CHAT_ID_BASE + internal
  return Number.isSafeInteger(chatId) ? -chatId : null
}

function positiveInt(value: string | null | undefined): number | null {
  const parsed = integer(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function integer(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^-?[0-9]+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}
