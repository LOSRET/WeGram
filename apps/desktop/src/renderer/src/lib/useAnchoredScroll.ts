import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { nextJumpStep } from './jumpSettle'
import { readScrollPin } from './scrollGeometry'

export interface AnchoredScrollOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  /** Changing it (chat id) resets ready/anchor state. */
  resetKey: string | number
  bottomThreshold?: number
  /**
   * True while the caller is restoring a saved anchor. Layout changes must not
   * re-derive the pin meanwhile: a restore walks the viewport through positions it
   * is about to correct away from, and mid-way the geometry can look "at the bottom".
   */
  restoringRef?: React.RefObject<boolean>
}

export interface AnchoredScrollApi {
  ready: boolean
  atBottom: boolean
  markReady: () => void
  scrollToBottom: (smooth?: boolean) => void
  /** Drop the stick-to-bottom pin without moving — used when restoring a saved anchor. */
  unpin: () => void
  /**
   * Re-derive the pin from the current geometry. Call it after a programmatic move
   * or a layout change the observers cannot see (see `useInitialPosition`).
   */
  syncPin: () => void
}

/** Timers and input listeners belonging to one "jump to the newest message". */
interface Jump {
  timers: number[]
  detach: (() => void)[]
}

/** How often a jump re-checks whether it has arrived, and when it gives up. */
const JUMP_TICK_MS = 50
const JUMP_DEADLINE_MS = 900

/**
 * Rules 1, 3 and 4 of design doc §8.2 live here:
 *
 *  1. entering a chat lands at the bottom without flashing the top (ready gate)
 *  3. auto-scroll only while the user is at the bottom (40px threshold)
 *  4. viewport/content height changes are compensated instead of jumping
 *
 * Rule 2 (keeping the viewport still while older messages are prepended) needs
 * a specific message as the reference, so it lives in MessageList where the
 * row DOM is available.
 *
 * The pin is a *function of geometry*, not of scroll events: a transcript that fits
 * the viewport never scrolls, so waiting for a scroll event to notice "there is
 * nothing to scroll any more" leaves `atBottom` stale forever.
 */
export function useAnchoredScroll({
  scrollRef,
  contentRef,
  resetKey,
  bottomThreshold = 40,
  restoringRef,
}: AnchoredScrollOptions): AnchoredScrollApi {
  const [ready, setReady] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const pinnedRef = useRef(true)
  /** A jump to the newest message is in flight; it owns the scroll position. */
  const movingRef = useRef(false)
  const jumpRef = useRef<Jump | null>(null)

  const syncPin = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const { pinned } = readScrollPin(el, bottomThreshold)
    pinnedRef.current = pinned
    setAtBottom((previous) => (previous === pinned ? previous : pinned))
  }, [scrollRef, bottomThreshold])

  /** Abandon an in-flight jump without moving: drop its timers and listeners. */
  const cancelJump = useCallback((): void => {
    const jump = jumpRef.current
    if (!jump) return
    jumpRef.current = null
    movingRef.current = false
    for (const timer of jump.timers) window.clearTimeout(timer)
    for (const detach of jump.detach) detach()
  }, [])

  const scrollToBottom = useCallback(
    (smooth = false) => {
      const el = scrollRef.current
      if (!el) return
      cancelJump()
      pinnedRef.current = true
      setAtBottom(true)

      if (!smooth || typeof el.scrollTo !== 'function') {
        el.scrollTop = el.scrollHeight
        return
      }

      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })

      /**
       * A programmatic smooth scroll cannot be trusted to arrive. Chromium cancels
       * the animation as soon as the scroll range changes — and the virtualiser
       * changes it *during* the move, because the rows it reveals are measured for
       * the first time exactly then. The reader is left thousands of pixels short
       * and the buoy is already gone, so nothing reports it.
       *
       * Two things make the move own itself until it lands:
       *
       *  - `movingRef` keeps the pin. The scroll events of the way down say "not at
       *    the bottom" by definition; re-deriving the pin from them hid the buoy
       *    halfway and left the shortfall unobserved.
       *  - The tick net below (timers, not rAF: an occluded window throttles frames)
       *    notices the animation stalling and finishes the move, and it keeps
       *    snapping while the rows around the landing are still being measured.
       */
      movingRef.current = true
      const jump: Jump = { timers: [], detach: [] }
      jumpRef.current = jump
      let previousGap = -1
      const started = Date.now()

      const stop = (): void => {
        if (jumpRef.current !== jump) return
        cancelJump()
        syncPin()
      }

      const tick = (): void => {
        if (jumpRef.current !== jump) return
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight
        const step = nextJumpStep({
          gap,
          previousGap,
          elapsed: Date.now() - started,
          deadline: JUMP_DEADLINE_MS,
        })
        if (step === 'landed') {
          stop()
          return
        }
        if (step === 'give-up') {
          el.scrollTop = el.scrollHeight
          stop()
          return
        }
        if (step === 'stalled') {
          // Nothing else will move the element again: finish the move ourselves.
          el.scrollTop = el.scrollHeight
          previousGap = -1
        } else {
          previousGap = gap
        }
        jump.timers.push(window.setTimeout(tick, JUMP_TICK_MS))
      }
      jump.timers.push(window.setTimeout(tick, JUMP_TICK_MS))

      // The reader takes over immediately: a wheel, a drag on the transcript or a
      // navigation key ends the move instead of fighting it.
      const takeover = (): void => stop()
      const passive: AddEventListenerOptions = { passive: true }
      for (const target of [el]) {
        for (const name of ['wheel', 'touchstart', 'pointerdown'] as const) {
          target.addEventListener(name, takeover, passive)
          jump.detach.push(() => target.removeEventListener(name, takeover))
        }
      }
      window.addEventListener('keydown', takeover)
      jump.detach.push(() => window.removeEventListener('keydown', takeover))
    },
    [cancelJump, scrollRef, syncPin],
  )

  // Reset per chat: hide the list until the first paint is anchored at the bottom.
  useLayoutEffect(() => {
    cancelJump()
    setReady(false)
    pinnedRef.current = true
    setAtBottom(true)
  }, [resetKey, cancelJump])

  // Track whether the user is at the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onScroll = (): void => {
      // Mid-jump positions are not reading positions (see `scrollToBottom`).
      if (movingRef.current) return
      syncPin()
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef, syncPin])

  /**
   * Content growth while pinned (new message, image load, row measurement) keeps the
   * bottom glued; container resizes (window, composer growth) do the same.
   *
   * The other direction is the one that used to be missed: an *unpinned* list can end
   * up with nothing left to scroll — rows measure shorter than the virtualizer's
   * estimates, the window grows, messages are deleted. No scroll event reports that,
   * so the pin is re-derived here. Without it the reader gets a "↓ N 条新消息" buoy
   * over a message that is fully visible, and the list stops following new messages.
   */
  useEffect(() => {
    const content = contentRef.current
    const el = scrollRef.current
    if (!content || !el) return

    const onLayoutChange = (): void => {
      // A jump has not landed yet: the growth it causes must not snap it to the end
      // half way (see `scrollToBottom`).
      if (movingRef.current) return
      if (!pinnedRef.current) {
        if (!restoringRef?.current) syncPin()
        return
      }
      el.scrollTop = el.scrollHeight
    }
    const observer = new ResizeObserver(onLayoutChange)
    observer.observe(content)
    observer.observe(el)
    return () => observer.disconnect()
  }, [contentRef, scrollRef, syncPin, restoringRef])

  const markReady = useCallback(() => setReady(true), [])

  // Restoring a saved anchor is an intentional "not at the bottom": without this
  // the ResizeObserver would glue the viewport to the bottom on the next
  // measurement and undo the restore.
  const unpin = useCallback(() => {
    cancelJump()
    pinnedRef.current = false
    setAtBottom(false)
  }, [cancelJump])

  // An unmounted list must not leave a jump's timers and listeners running.
  useEffect(() => cancelJump, [cancelJump])

  return { ready, atBottom, markReady, scrollToBottom, unpin, syncPin }
}
