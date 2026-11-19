import type { ChatSummary } from '@wegram/protocol'

/** One alphabet section of the 通讯录: a heading and its contact rows. */
export interface ContactGroup {
  /** A–Z, or '#' for names that do not start with a Latin letter. */
  initial: string
  contacts: ChatSummary[]
}

const LATIN_INITIAL = /^[a-z]$/i
const HAN = /\p{Script=Han}/u
/** Chinese collation orders Han characters by pinyin (ICU); this is the default. */
const COLLATOR = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' })

/**
 * Where each pinyin initial starts, written as the first Han character of that
 * syllable. `localeCompare` orders Han by pinyin, so a name's section is the
 * last boundary it sorts at or after — no pinyin table shipped with the app.
 * I/U/V have no initials in pinyin and are therefore absent.
 */
const PINYIN_STARTS: ReadonlyArray<readonly [string, string]> = [
  ['A', '阿'],
  ['B', '八'],
  ['C', '擦'],
  ['D', '搭'],
  ['E', '蛾'],
  ['F', '发'],
  ['G', '噶'],
  ['H', '哈'],
  ['J', '击'],
  ['K', '喀'],
  ['L', '垃'],
  ['M', '妈'],
  ['N', '拿'],
  ['O', '哦'],
  ['P', '啪'],
  ['Q', '期'],
  ['R', '然'],
  ['S', '撒'],
  ['T', '塌'],
  ['W', '挖'],
  ['X', '昔'],
  ['Y', '压'],
  ['Z', '匝'],
]

/**
 * The conversations the 通讯录 lists as contacts: private chats, minus our own
 * Saved Messages conversation (TDLib turns it into a private chat with ourselves).
 *
 * A chat without `userId` is kept on purpose: an adapter that does not know the
 * peer id must not make the whole address book disappear.
 */
export function contactChats(chats: ChatSummary[], selfUserId: number | null): ChatSummary[] {
  return chats.filter(
    (chat) =>
      chat.kind === 'private' &&
      !(selfUserId !== null && chat.userId !== undefined && chat.userId === selfUserId),
  )
}

/**
 * The section a name belongs to: A–Z for Latin initials, the pinyin initial for
 * Han names (the client sorts Chinese friends the same way) and '#' for anything
 * else — digits, emoji and other scripts.
 */
export function contactInitial(title: string): string {
  const first = Array.from(title.trim()).at(0) ?? ''
  if (LATIN_INITIAL.test(first)) return first.toUpperCase()
  if (!HAN.test(first)) return '#'
  let initial = '#'
  for (const [letter, boundary] of PINYIN_STARTS) {
    if (COLLATOR.compare(first, boundary) >= 0) initial = letter
    else break
  }
  return initial
}

/**
 * Groups contacts by initial and sorts them the way the client does: A–Z, then
 * the '#' bucket last; names inside a bucket use the Chinese collation so people
 * sharing an initial keep a stable, locale-correct order.
 */
export function groupContacts(contacts: ChatSummary[]): ContactGroup[] {
  const buckets = new Map<string, ChatSummary[]>()
  for (const chat of contacts) {
    const initial = contactInitial(chat.title)
    const bucket = buckets.get(initial)
    if (bucket) bucket.push(chat)
    else buckets.set(initial, [chat])
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([initial, items]) => ({
      initial,
      contacts: items.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN')),
    }))
}
