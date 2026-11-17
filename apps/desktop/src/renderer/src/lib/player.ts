/**
 * The arithmetic behind the video window's player bar (design doc §9.5).
 *
 * Kept pure and DOM-free so the clock format, the seek clamp and the progress
 * ratio are unit-tested instead of being re-derived inside the component.
 */

/** What the 倍速 menu offers, slowest first; the client's list. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

/** `00:51`, and `1:02:03` past the hour — the client pads to mm:ss. */
export function playerClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** 0…1 of the timeline; a missing or zero duration is an empty bar, not NaN. */
export function progressRatio(current: number, duration: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(1, Math.max(0, current / duration))
}

/** A relative seek (←/→ in the window) clamped to the clip. */
export function seekTarget(current: number, duration: number, delta: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(duration, Math.max(0, current + delta))
}

/** A click/drag on the timeline: ratio → seconds. */
export function timeAtRatio(ratio: number, duration: number): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(duration, Math.max(0, ratio * duration))
}
