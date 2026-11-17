import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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

  const scrollToBottom = useCallback(
    (smooth = false) => {
      const el = scrollRef.current
      if (!el) return
      pinnedRef.current = true
      setAtBottom(true)
      if (smooth && typeof el.scrollTo === 'function') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      } else {
        el.scrollTop = el.scrollHeight
      }
    },
    [scrollRef],
  )

  // Reset per chat: hide the list until the first paint is anchored at the bottom.
  useLayoutEffect(() => {
    setReady(false)
    pinnedRef.current = true
    setAtBottom(true)
  }, [resetKey])

  const syncPin = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const { pinned } = readScrollPin(el, bottomThreshold)
    pinnedRef.current = pinned
    setAtBottom((previous) => (previous === pinned ? previous : pinned))
  }, [scrollRef, bottomThreshold])

  // Track whether the user is at the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onScroll = (): void => syncPin()

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
    pinnedRef.current = false
    setAtBottom(false)
  }, [])

  return { ready, atBottom, markReady, scrollToBottom, unpin, syncPin }
}
