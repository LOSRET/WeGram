import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface AnchoredScrollOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  /** Changing it (chat id) resets ready/anchor state. */
  resetKey: string | number
  bottomThreshold?: number
}

export interface AnchoredScrollApi {
  ready: boolean
  atBottom: boolean
  markReady: () => void
  scrollToBottom: (smooth?: boolean) => void
  /** Drop the stick-to-bottom pin without moving — used when restoring a saved anchor. */
  unpin: () => void
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
 */
export function useAnchoredScroll({
  scrollRef,
  contentRef,
  resetKey,
  bottomThreshold = 40,
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

  // Track whether the user is at the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      const pinned = distance <= bottomThreshold
      pinnedRef.current = pinned
      setAtBottom((previous) => (previous === pinned ? previous : pinned))
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef, bottomThreshold])

  // While pinned, every content growth (new message, image load, measurement)
  // keeps the bottom glued; while unpinned nothing is touched.
  useEffect(() => {
    const content = contentRef.current
    const el = scrollRef.current
    if (!content || !el) return

    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [contentRef, scrollRef])

  // Container resize (window, composer growth): same rule.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRef])

  const markReady = useCallback(() => setReady(true), [])

  // Restoring a saved anchor is an intentional "not at the bottom": without this
  // the ResizeObserver would glue the viewport to the bottom on the next
  // measurement and undo the restore.
  const unpin = useCallback(() => {
    pinnedRef.current = false
    setAtBottom(false)
  }, [])

  return { ready, atBottom, markReady, scrollToBottom, unpin }
}
