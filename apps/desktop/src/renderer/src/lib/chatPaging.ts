/**
 * 会话列表分页: when is the next slice worth asking for?
 *
 * The shell loads the first page (`chats:list`, 100 rows) and the list used to
 * stop there — a chat ranked below the page only appeared if TDLib happened to
 * push an update for it. Telegram Desktop solves the same thing the same way:
 * when the visible window plus a margin reaches the end of what is loaded, ask
 * for the next slice.
 *
 * Kept pure and apart from the hook so `pnpm test` can pin the rule: the hook
 * beside it only remembers loading / done / offset.
 */

/** One page is the same size the shell fetches on start-up (and the protocol cap). */
export const CHAT_PAGE_SIZE = 100

/** Rows kept ahead of the reader: a page takes a second, the wheel does not. */
export const CHAT_LOAD_AHEAD = 30

/**
 * Has the virtual window reached the end of the loaded rows?
 *
 * `lastIndex` is the last mounted row (the virtualiser's overscan included), so
 * this fires before the reader can see the bottom. An empty list answers false:
 * the empty state is its own case and must not page forever.
 */
export function nearListEnd(lastIndex: number, count: number, ahead = CHAT_LOAD_AHEAD): boolean {
  if (count <= 0 || lastIndex < 0) return false
  return lastIndex >= count - ahead
}
