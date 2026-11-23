import { useCallback, useEffect, useRef, useState } from 'react'

import { invoke } from '../../lib/ipc'
import { DEFAULT_VOLUME, readVolume } from '../../lib/player'

/**
 * The player's 音量 (design doc §9.5): the level outlives the window (it is stored in
 * `ui.db`), while 静音 is per-session — the client reopens a clip unmuted at the level
 * the last one was left at.
 *
 * `VideoCanvas` owns the `<video>` element and applies both values in an effect; this
 * hook only holds the number, maps 静音 to the icon, and makes a drag write once on
 * release instead of on every pixel it moves.
 */
export function useViewerVolume() {
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME)
  const [muted, setMuted] = useState(false)
  /** The live level, so a write started from a callback never reads stale state. */
  const level = useRef(DEFAULT_VOLUME)
  /** The level 静音 was turned on at, so 取消静音 does not jump to 100 %. */
  const loud = useRef(DEFAULT_VOLUME)
  /** What `ui.db` already holds: a drag that ends where it started writes nothing. */
  const saved = useRef(DEFAULT_VOLUME)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    // A missing row (never dragged) and a failed read both mean full volume: a lost
    // preference must never open a clip silent.
    void invoke('ui:getViewerVolume')
      .then((stored) => {
        if (!alive.current || stored === null) return
        const next = readVolume(stored)
        level.current = next
        loud.current = next > 0 ? next : DEFAULT_VOLUME
        saved.current = next
        setVolumeState(next)
      })
      .catch(() => undefined)
    return () => {
      alive.current = false
    }
  }, [])

  const apply = useCallback((next: number) => {
    const value = readVolume(next)
    level.current = value
    if (value > 0) {
      loud.current = value
      // Dragging the capsule up is how the client leaves 静音.
      setMuted(false)
    }
    setVolumeState(value)
  }, [])

  const store = useCallback((value: number) => {
    saved.current = value
    void invoke('ui:setViewerVolume', { volume: value }).catch(() => undefined)
  }, [])

  /** A drag on the capsule: repaint only; `commit` stores the level it ended on. */
  const setVolume = useCallback((next: number) => apply(next), [apply])

  const commit = useCallback(() => {
    if (level.current !== saved.current) store(level.current)
  }, [store])

  /** ↑/↓: one 5 % step, stored as it happens. */
  const step = useCallback(
    (delta: number) => {
      apply(level.current + delta)
      store(level.current)
    },
    [apply, store],
  )

  const toggleMute = useCallback(() => {
    // A level of 0 has no "unmute" of its own: restore the last audible one instead of
    // leaving the speaker struck through with nothing to turn back on.
    if (level.current <= 0) {
      apply(loud.current > 0 ? loud.current : DEFAULT_VOLUME)
      store(level.current)
      return
    }
    setMuted((value) => !value)
  }, [apply, store])

  return { volume, muted, setVolume, commit, step, toggleMute }
}
