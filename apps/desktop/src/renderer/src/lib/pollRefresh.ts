import type { Poll } from '@wegram/protocol'

/**
 * Visible polls are re-read more often than TDLib's own 42–60 second results poll.
 * The read keeps the containing message in TDLib's LRU; an evicted comment row is
 * loaded again, which re-registers its poll and triggers an immediate results fetch.
 */
export const POLL_REFRESH_MS = 5_000

/** Closed polls are final and need no foreground keepalive. */
export function pollRefreshInterval(poll: Pick<Poll, 'closed'>): number | null {
  return poll.closed ? null : POLL_REFRESH_MS
}
