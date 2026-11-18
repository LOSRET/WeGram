/**
 * The one decision a "jump to the newest message" tick has to make.
 *
 * The jump is a smooth scroll, and Chromium cancels a programmatic smooth scroll as
 * soon as the scroll range changes — which the virtualised transcript does on every
 * row it measures on the way down (measured: 32 320px of content, the move died at
 * 11 486 and the reader was left there). The animation therefore cannot be trusted
 * to arrive and the move has to watch its own geometry and finish itself. This is
 * the pure part of that loop, so the rules are testable without a DOM; the timers
 * and the `scrollTop` write live in `useAnchoredScroll`.
 */

/** Gap under which the move counts as landed (a subpixel of rounding is allowed). */
export const JUMP_ARRIVED_PX = 1

export interface JumpProgress {
  /** Pixels between the viewport's bottom edge and the end of the content. */
  readonly gap: number
  /** The gap measured on the previous tick, or -1 before the first one. */
  readonly previousGap: number
  /** Milliseconds since the move started, and the point at which it stops trying. */
  readonly elapsed: number
  readonly deadline: number
}

export type JumpStep =
  /** The bottom is in view: stop moving and let the pin take over again. */
  | 'landed'
  /** The animation moved since the last tick: keep watching it. */
  | 'wait'
  /** The animation died where it was: snap to the end and keep watching. */
  | 'stalled'
  /** Out of time: snap to the end and stop, even if measurements still move it. */
  | 'give-up'

export function nextJumpStep({ gap, previousGap, elapsed, deadline }: JumpProgress): JumpStep {
  if (gap <= JUMP_ARRIVED_PX) return 'landed'
  if (elapsed >= deadline) return 'give-up'
  if (gap === previousGap) return 'stalled'
  return 'wait'
}
