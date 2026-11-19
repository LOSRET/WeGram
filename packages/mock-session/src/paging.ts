/**
 * The paging arithmetic of a fake transcript.
 *
 * The mock adapter (main process) and the browser preview (renderer) both serve
 * pages out of an in-memory array. They had two copies of this slicing, and the
 * two copies disagreed on `hasMore` before anyone noticed — the browser preview
 * is the only place a UI change gets tried, so a disagreement there is invisible
 * in Electron and vice versa.
 */

export interface OlderPage<T> {
  messages: T[]
  hasMore: boolean
}

export interface AroundPage<T> {
  messages: T[]
  hasMore: boolean
  hasNewer: boolean
}

export interface NewerPage<T> {
  messages: T[]
  hasNewer: boolean
}

/** The newest `limit` messages below an exclusive cursor (undefined = newest). */
export function pageOlder<T extends { id: number }>(
  all: readonly T[],
  cursor: number | undefined,
  limit: number,
): OlderPage<T> {
  const older = cursor === undefined ? all : all.filter((message) => message.id < cursor)
  const page = older.slice(Math.max(0, older.length - limit))
  return { messages: [...page], hasMore: page.length < older.length }
}

/**
 * A window centred on one message: `limit` on each side, the anchor included.
 *
 * An id that is not in the array anchors on the first message newer than it, so
 * a deleted saved position still opens where the reader left off.
 */
export function pageAround<T extends { id: number }>(
  all: readonly T[],
  messageId: number,
  limit: number,
): AroundPage<T> {
  const found = all.findIndex((message) => message.id === messageId)
  const center = found >= 0 ? found : all.findIndex((message) => message.id > messageId)
  if (center < 0) return { messages: [], hasMore: true, hasNewer: false }
  const start = Math.max(0, center - limit)
  const end = Math.min(all.length, center + limit + 1)
  return {
    messages: all.slice(start, end),
    hasMore: start > 0,
    hasNewer: end < all.length,
  }
}

/** The page immediately newer than an anchored window's newest message. */
export function pageNewer<T extends { id: number }>(
  all: readonly T[],
  fromMessageId: number,
  limit: number,
): NewerPage<T> {
  const newer = all.filter((message) => message.id > fromMessageId)
  return { messages: newer.slice(0, limit), hasNewer: newer.length > limit }
}
