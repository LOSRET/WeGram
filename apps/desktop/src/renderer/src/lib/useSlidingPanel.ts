import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The slide a panel in and out model (renderer/AGENTS.md).
 *
 * A CSS slide needs its element mounted closed for one frame before the open
 * class lands, and on close the parent must keep it mounted until the transform
 * has finished — otherwise the panel vanishes mid-slide. rAF alone cannot time
 * the entry: Electron throttles it while the window is occluded, so the flip is a
 * 20 ms timeout (the same fallback the styles are pinned to).
 *
 * The four panels that slide (聊天信息, 评论, 已归档会话, 话题) used to carry their
 * own copy of this machine, including the reopen-during-slide-out race. It lives
 * here once so that race is solved once.
 */

/** How long a panel waits before its open class lands (rAF fallback). */
const ENTER_DELAY_MS = 20

export interface SlidingPanel<T> {
  value: T
  open: boolean
}

export interface SlidingPanelControl<T> {
  /** The mounted panel, or null once it has slid out. `value` is its content. */
  panel: SlidingPanel<T> | null
  isOpen: boolean
  /** Opens with a new content; a close still in flight is cancelled. */
  open: (value: T) => void
  /** Starts the slide-out; the panel unmounts after `animationMs`. */
  close: () => void
  /** Drops the panel and its timer now (another conversation owns it). */
  reset: () => void
}

export function useSlidingPanel<T>(animationMs: number): SlidingPanelControl<T> {
  const [panel, setPanel] = useState<SlidingPanel<T> | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const open = useCallback(
    (value: T) => {
      clearTimer()
      setPanel({ value, open: true })
    },
    [clearTimer],
  )

  const close = useCallback(() => {
    setPanel((current) => (current ? { ...current, open: false } : null))
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      // A reopen during the slide-out already cleared the flag: only a panel
      // that is still closed is dropped here.
      setPanel((current) => (current !== null && !current.open ? null : current))
    }, animationMs)
  }, [animationMs, clearTimer])

  const reset = useCallback(() => {
    clearTimer()
    setPanel(null)
  }, [clearTimer])

  // A window closing mid-slide must not leave a timer behind.
  useEffect(() => clearTimer, [clearTimer])

  return { panel, isOpen: panel?.open === true, open, close, reset }
}

/**
 * Whether the panel's element has painted once since it opened, so its open
 * class can land on the next frame. Resets to false while closed.
 */
export function useEnterOnOpen(open: boolean): boolean {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    const timer = window.setTimeout(() => setEntered(true), ENTER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  return entered
}
