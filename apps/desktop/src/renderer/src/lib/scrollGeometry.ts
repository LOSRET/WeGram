/**
 * The one rule behind "the reader is at the newest message".
 *
 * Three places need the same answer — `useAnchoredScroll` (on scroll *and* on every
 * layout change), `useAnchorSave` (whether to store a position at all) and
 * `useInitialPosition` (whether a saved anchor can even be honoured) — so it lives
 * here instead of being re-derived from magic numbers at each call site.
 *
 * The interesting case is the one with no scroll event: a transcript that fits the
 * viewport cannot scroll, so it is pinned by construction, whatever an anchor or a
 * resized window says. Geometry decides, not scroll events — that distinction is
 * exactly what once left `atBottom === false` on a transcript the reader could see
 * in full, and the next incoming message raised the "↓ N 条新消息" buoy.
 */

/** Slack under which the reader still counts as "at the bottom" (design doc §8.2). */
export const BOTTOM_THRESHOLD_PX = 40

/** The three numbers every "at the bottom" decision is made from. */
export interface ScrollerGeometry {
  readonly scrollHeight: number
  readonly scrollTop: number
  readonly clientHeight: number
}

export interface ScrollPin {
  /** Pixels between the viewport and the end of the content (negative when it fits). */
  distance: number
  /** The whole transcript fits: there is no scroll position to restore or keep. */
  fits: boolean
  /** The reader is at, or within the threshold of, the newest message. */
  pinned: boolean
}

export function readScrollPin(
  geometry: ScrollerGeometry,
  threshold = BOTTOM_THRESHOLD_PX,
): ScrollPin {
  const distance = geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight
  return {
    distance,
    fits: geometry.scrollHeight <= geometry.clientHeight,
    pinned: distance <= threshold,
  }
}
