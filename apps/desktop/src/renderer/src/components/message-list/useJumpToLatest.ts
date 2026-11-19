import type { Virtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, type RefObject } from 'react'

import { useAppStore } from '../../store/useAppStore'
import { resyncScroller } from './scroller'

interface JumpToLatestDeps {
  chatId: number
  scrollRef: RefObject<HTMLDivElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
  scrollToBottom: () => void
}

/**
 * A latest-window reload replaces every row, so the viewport has to follow it to
 * the end. The signal is per chat and consumed by a mount-time ref: a tick meant
 * for another conversation must not move this one when it is mounted later.
 */
export function useJumpToLatest({
  chatId,
  scrollRef,
  virtualizer,
  scrollToBottom,
}: JumpToLatestDeps): void {
  const jumpToLatest = useAppStore((state) => state.jumpToLatest)
  const consumedJumpTick = useRef(jumpToLatest?.tick ?? 0)

  useEffect(() => {
    if (!jumpToLatest || jumpToLatest.chatId !== chatId) return
    if (jumpToLatest.tick === consumedJumpTick.current) return
    consumedJumpTick.current = jumpToLatest.tick
    const land = (): void => {
      virtualizer.scrollToEnd()
      scrollToBottom()
      resyncScroller(scrollRef.current)
    }
    const frame = requestAnimationFrame(land)
    // rAF is throttled for an occluded window (see useInitialPosition); the timer
    // is the net that still lands the scroll.
    const timer = window.setTimeout(land, 80)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [jumpToLatest, chatId, scrollRef, virtualizer, scrollToBottom])
}
