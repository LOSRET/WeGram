import type { ChatSummary, Message, SearchMessagesCursor } from '@wegram/protocol'

/**
 * The search panel's two halves: 聊天 (private chats and groups) and 频道
 * (channels). One type because the panel, the adapter request and the two
 * fakes' cursor fields all speak it.
 */
export type SearchScope = 'chat' | 'channel'

export const SEARCH_SCOPES: readonly SearchScope[] = ['chat', 'channel']

/** One result row: the message plus the chat it lives in (title, avatar, kind). */
export interface MessageHit {
  message: Message
  chat: ChatSummary
}

/** Chat id + message id is unique across the account, even in a merged page. */
export function hitKey(hit: MessageHit): string {
  return hit.chat.id + ':' + hit.message.id
}

/**
 * Joins a page's messages to its chat summaries. A message whose chat summary is
 * missing is dropped rather than drawn with a blank title (the adapter always
 * ships one per chat, so this only guards a broken response).
 */
export function pageHits(messages: Message[], chats: ChatSummary[]): MessageHit[] {
  const byId = new Map(chats.map((chat) => [chat.id, chat]))
  const hits: MessageHit[] = []
  for (const message of messages) {
    const chat = byId.get(message.chatId)
    if (chat) hits.push({ message, chat })
  }
  return hits
}

/**
 * Appends one page. TDLib pages are disjoint, but the 聊天 tab merges two streams
 * and a live edit can re-surface a row between requests, so duplicates are
 * dropped by hitKey instead of being trusted away.
 */
export function mergeHits(existing: MessageHit[], incoming: MessageHit[]): MessageHit[] {
  const seen = new Set(existing.map(hitKey))
  const merged = existing.slice()
  for (const hit of incoming) {
    const key = hitKey(hit)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(hit)
  }
  return merged
}

/** Whether any stream of a cursor still has a page (empty offset = exhausted). */
export function cursorHasMore(cursor: SearchMessagesCursor | null): boolean {
  if (cursor === null) return false
  return cursor.private !== '' || cursor.group !== '' || cursor.channel !== ''
}
