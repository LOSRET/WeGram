import type { Poll } from '@wegram/protocol'

/**
 * Visible polls are re-read while they are on screen. Ten seconds is fast enough to
 * feel live and slow enough that a screenful of polls stays a handful of requests a
 * minute — the official client's own visible-poll request runs on a similar cadence.
 * A comment-thread poll's read is a server request (see `usePollRefresh`); an
 * ordinary poll's read is the local `getMessage` touch.
 */
export const POLL_REFRESH_MS = 10_000

/** Closed polls are final and need no foreground keepalive. */
export function pollRefreshInterval(poll: Pick<Poll, 'closed'>): number | null {
  return poll.closed ? null : POLL_REFRESH_MS
}
