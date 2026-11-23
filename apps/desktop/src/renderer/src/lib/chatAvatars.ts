import type { ChatSummary } from '@wegram/protocol'

/**
 * The visible rows whose photo nobody has asked for yet.
 *
 * `ChatRow` draws `chat.avatarUrl` and nothing else, so a row that appears
 * without an upsert — a chat paged in as the reader reaches the end — keeps its
 * initials for the session: the adapter's photo pool only prefetches the page it
 * was handed. These ids are what `chats:prefetchAvatars` exists for, and the
 * finished photo comes back as an ordinary `chats` upsert.
 *
 * `requested` is the hook's memory of what it already asked for: the pool
 * remembers misses for the session, so asking again would only cost an IPC round
 * trip per scroll tick.
 */
export function missingAvatarIds(
  chats: ChatSummary[],
  from: number,
  to: number,
  requested: ReadonlySet<number>,
): number[] {
  const start = Math.max(0, from)
  const end = Math.min(chats.length - 1, to)
  const ids: number[] = []
  for (let index = start; index <= end; index += 1) {
    const chat = chats[index]
    if (!chat || chat.avatarUrl || requested.has(chat.id)) continue
    ids.push(chat.id)
  }
  return ids
}
