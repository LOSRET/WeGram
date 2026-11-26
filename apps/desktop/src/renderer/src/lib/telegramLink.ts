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
 * A username link may also carry a bot's validated `start` payload; that is kept
 * on the target for the first-open screen rather than discarded with the query.
 */
export type TelegramLinkTarget =
  | {
      kind: 'username'
      username: string
      messageId?: number
      startParameter?: string
      /**
       * `t.me/<bot>/<app>`: a Mini App link (design doc §9.4). The short name is
       * passed to TDLib (`getWebAppLinkUrl`), which signs the URL; this parser
       * only recognises the shape.
       */
      webApp?: { shortName: string; startParameter?: string }
    }
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

/**
 * A link carries a post's *server* number; TDLib message ids are that number
 * shifted left by 20 (`MessageId.h`: `server_message_id << 20`, the low 20 bits
 * are the type tag). Passing the raw number to `messages:around` made TDLib
 * answer 400 "Invalid value of parameter from_message_id specified" — most post
 * numbers are not a valid MessageId at all — and for the rest it located an
 * unrelated message. The conversion belongs next to the chat-id arithmetic below
 * and is pinned by the unit tests.
 */
const MESSAGE_ID_SHIFT = 2 ** 20

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
    const messageId = linkedMessageId(rest[1])
    if (rest[1] !== undefined && messageId === undefined) return null
    return messageId === undefined ? { kind: 'chat', chatId } : { kind: 'chat', chatId, messageId }
  }
  if (name === undefined || name.startsWith('+') || NOT_A_CHAT.has(name)) return null
  if (!USERNAME.test(name)) return null
  // A public link has at most one segment after the name (a post or an app).
  if (rest.length > 1) return null
  /**
   * `t.me/<bot>/<app>`: a third path that is not a post number names a Mini App.
   * A numeric segment is always Telegram's server post number, and a bot's app
   * short name is a username-shaped word (Bot API's own rule).
   */
  if (rest[0] !== undefined && !/^[0-9]+$/.test(rest[0])) {
    if (rest.length > 1 || !USERNAME.test(rest[0])) return null
    const start = webAppStartParameterOf(url)
    return {
      kind: 'username',
      username: name,
      webApp: { shortName: rest[0], ...(start === undefined ? {} : { startParameter: start }) },
    }
  }
  const messageId = linkedMessageId(rest[0])
  if (rest[0] !== undefined && messageId === undefined) return null
  const startParameter = startParameterOf(url)
  return {
    kind: 'username',
    username: name,
    ...(messageId === undefined ? {} : { messageId }),
    ...(startParameter === undefined ? {} : { startParameter }),
  }
}

/** `tg://` actions the official clients emit: resolve, user and openmessage. */
function fromTg(url: URL): TelegramLinkTarget | null {
  const action = url.hostname.toLowerCase()
  if (action === 'resolve') {
    const username = url.searchParams.get('domain') ?? ''
    if (!USERNAME.test(username)) return null
    const messageId = linkedMessageId(url.searchParams.get('post') ?? undefined)
    const startParameter = startParameterOf(url)
    return {
      kind: 'username',
      username,
      ...(messageId === undefined ? {} : { messageId }),
      ...(startParameter === undefined ? {} : { startParameter }),
    }
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
    const messageId = linkedMessageId(url.searchParams.get('message_id') ?? undefined)
    return messageId === undefined ? { kind: 'chat', chatId } : { kind: 'chat', chatId, messageId }
  }
  return null
}

/** Telegram bot start payloads are 1-64 base64url characters. */
function startParameterOf(url: URL): string | undefined {
  const value = url.searchParams.get('start')
  return value && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : undefined
}

/** A Mini App's `startapp` payload; longer than a bot `start` payload. */
function webAppStartParameterOf(url: URL): string | undefined {
  const value = url.searchParams.get('startapp')
  return value && /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : undefined
}

function internalChatId(value: string | undefined): number | null {
  const internal = positiveInt(value)
  if (internal === null) return null
  const chatId = SUPERGROUP_CHAT_ID_BASE + internal
  return Number.isSafeInteger(chatId) ? -chatId : null
}

/** A link's post number as a TDLib message id; `undefined` when it is not one. */
function linkedMessageId(raw: string | undefined): number | undefined {
  const post = positiveInt(raw)
  if (post === null) return undefined
  const id = post * MESSAGE_ID_SHIFT
  return Number.isSafeInteger(id) ? id : undefined
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
