/**
 * The fake account's two search paths, shared by the two fakes.
 *
 * The mock adapter (main process) and the browser preview (renderer) each answer
 * the same `search:global` / `search:messages` / `search:inChat` channels over
 * their own store. They used to implement the matching twice, and the title rule
 * had already drifted: one trimmed the query, the other did not, so an empty one
 * answered "every chat" in the mock and "nothing" in the preview. This is the
 * one reading of a search box for both.
 *
 * Structural on purpose: this package imports nothing, so the callers hand in
 * their own chat and message rows.
 */

/** 聊天 / 频道: the chat list's global search over titles. */
export function searchChatRows<T extends { title: string }>(
  chats: readonly T[],
  q: string,
  limit: number,
): T[] {
  const needle = q.trim().toLowerCase()
  // An empty box searches for nothing. TDLib is never asked either: the panel
  // only calls this once the needle is non-empty.
  if (needle === '') return []
  return chats.filter((chat) => chat.title.toLowerCase().includes(needle)).slice(0, limit)
}

/** The 聊天文件 tabs: a message kind each, plus 'url' for a text link or a card. */
export type MessageSearchFilter = 'photo' | 'video' | 'file' | 'url'

/** The fields the in-chat rules read; both fakes' rows satisfy this structurally. */
interface SearchableRow {
  text: string
  kind?: string
  entities?: readonly { type: string }[]
  linkPreview?: unknown
}

function matchesFilter(message: SearchableRow, filter: MessageSearchFilter): boolean {
  switch (filter) {
    case 'photo':
      return message.kind === 'photo'
    case 'video':
      return message.kind === 'video'
    case 'file':
      return message.kind === 'file'
    case 'url':
      // A bare URL entity and a preview card are both "a link" to the reader; a
      // hidden textUrl is one too (the words carry the target).
      return (
        message.linkPreview !== undefined ||
        (message.entities?.some((entity) => entity.type === 'url' || entity.type === 'textUrl') ??
          false)
      )
  }
}

/**
 * 查找聊天内容: a case-insensitive substring match inside one transcript.
 *
 * With a filter this is the panel's 图片 / 视频 / 文件 / 链接 tab: an empty box
 * means "everything of that kind", exactly like TDLib's filter with an empty
 * query. Without one, an empty box searches for nothing (the text tab's rule).
 */
export function searchMessageRows<T extends SearchableRow>(
  messages: readonly T[],
  q: string,
  filter?: MessageSearchFilter,
): T[] {
  const needle = q.trim().toLowerCase()
  if (needle === '' && filter === undefined) return []
  return messages.filter((message) => {
    if (filter !== undefined && !matchesFilter(message, filter)) return false
    return needle === '' || message.text.toLowerCase().includes(needle)
  })
}

export interface ScopeSearchEntry<C, M> {
  chat: C
  messages: readonly M[]
}

export interface ScopeSearchInput {
  q: string
  scope: 'chat' | 'channel'
  limit: number
  cursor?: { private?: string; group?: string; channel?: string }
}

export interface ScopeSearchPage<C, M> {
  messages: M[]
  chats: C[]
  total: number
  cursor: { private: string; group: string; channel: string }
}

/**
 * Cross-chat hits for the search panel's 聊天 / 频道 tabs: one merged stream per
 * scope, the numeric offset as its cursor, and `total` as what the panel prints
 * as 找到 N 条消息.
 *
 * The fixture account is small enough that one merged stream is the whole answer;
 * the real adapter asks TDLib and gets the cursor back.
 */
export function searchMessagesInScope<
  C extends { id: number; kind: string },
  M extends { id: number; date: number; text: string },
>(entries: Iterable<ScopeSearchEntry<C, M>>, input: ScopeSearchInput): ScopeSearchPage<C, M> {
  const needle = input.q.trim().toLowerCase()
  const wantChannel = input.scope === 'channel'
  const key = wantChannel ? 'channel' : 'private'
  const offset = Number.parseInt(input.cursor?.[key] ?? '0', 10) || 0

  const hits: { chat: C; message: M }[] = []
  for (const entry of entries) {
    // Group hits ride the 聊天 tab in the fixture: it has no group scope of its own.
    if ((entry.chat.kind === 'channel') !== wantChannel) continue
    for (const message of entry.messages) {
      if (message.text.toLowerCase().includes(needle)) {
        hits.push({ chat: entry.chat, message })
      }
    }
  }
  hits.sort((a, b) => b.message.date - a.message.date || b.message.id - a.message.id)

  const page = hits.slice(offset, offset + input.limit)
  const next = offset + input.limit < hits.length ? String(offset + input.limit) : ''
  // One row per chat, in first-hit order, copied so a caller cannot mutate the store.
  const chats = new Map<number, C>()
  for (const hit of page) {
    if (!chats.has(hit.chat.id)) chats.set(hit.chat.id, { ...hit.chat })
  }

  return {
    messages: page.map((hit) => hit.message),
    chats: [...chats.values()],
    total: hits.length,
    cursor: {
      private: wantChannel ? '' : next,
      group: '',
      channel: wantChannel ? next : '',
    },
  }
}
