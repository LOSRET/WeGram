import type { Virtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { findRowIndex, type TranscriptRow } from './rows'
import { resyncScroller } from './scroller'

/**
 * 定位到聊天位置: one scroll to the requested row, then a flash that fades out by
 * itself (the list owns the timer; nothing outside knows the row is special).
 *
 * The rows array is read through a ref: a message arriving must not re-run the
 * scroll, or every arrival would yank the reader back to the located picture.
 */
export function useLocateScroll({
  located,
  rows,
  scrollRef,
  virtualizer,
}: {
  located: number | null
  rows: readonly TranscriptRow[]
  scrollRef: RefObject<HTMLDivElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
}): number | null {
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [flashId, setFlashId] = useState<number | null>(null)

  useEffect(() => {
    if (located === null) return
    const el = scrollRef.current
    if (!el) return
    const scrollToRow = (): boolean => {
      const index = findRowIndex(rowsRef.current, located)
      if (index < 0) return false
      virtualizer.scrollToIndex(index, { align: 'start' })
      resyncScroller(el)
      return true
    }
    if (!scrollToRow()) return
    setFlashId(located)
    /**
     * Row heights are estimates until they are measured, and the first page may
     * still be settling; one correction after the paint is what the anchored
     * restore does in a loop. The frame-based path gets the timer net the whole
     * list uses: rAF is throttled while the window is occluded.
     */
    const correct = window.setTimeout(() => {
      scrollToRow()
    }, 80)
    const flashOut = window.setTimeout(() => setFlashId(null), 1600)
    return () => {
      window.clearTimeout(correct)
      window.clearTimeout(flashOut)
    }
  }, [located, scrollRef, virtualizer])

  return flashId
}
