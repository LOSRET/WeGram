import { useEffect, type RefObject } from 'react'

import type { LandingPosition } from './unread'

/**
 * The landing has to survive the reader leaving without scrolling.
 *
 *  - A saved position that turned out to be unusable — the transcript fits the
 *    viewport, so the reader is looking at the newest message anyway — must not
 *    stay in `ui.db`: a later, longer transcript would reopen scrolled up to an
 *    old row. Nothing else clears it, because a transcript that fits never
 *    scrolls.
 *  - Opening at the unread divider is itself a reading position, and no scroll
 *    event will ever record it. Stored as "this row at the top", because the
 *    divider only exists for this open (see `useAnchorSave.savePosition`).
 */
export function useLandingSave({
  ready,
  landing,
  atBottom,
  hasNewer,
  restoring,
  scheduleAnchorSave,
  savePosition,
}: {
  ready: boolean
  landing: LandingPosition | null
  atBottom: boolean
  hasNewer: boolean
  restoring: RefObject<boolean>
  scheduleAnchorSave: () => void
  savePosition: (anchor: { messageId: number | null; offset: number }) => void
}): void {
  useEffect(() => {
    if (!ready || landing === null || restoring.current) return
    if (landing.kind === 'unread') {
      // "At the bottom" must mean the chat's bottom: an anchored window's end is
      // an arbitrary old row, and storing `null` there would discard the position.
      if (!hasNewer && atBottom) scheduleAnchorSave()
      else savePosition({ messageId: landing.messageId, offset: 0 })
      return
    }
    if (hasNewer || !atBottom) return
    scheduleAnchorSave()
    // `restoring` is a ref, so its identity is stable; the refs inside the flags
    // object are what the effect actually reads.
  }, [ready, atBottom, hasNewer, landing, scheduleAnchorSave, savePosition, restoring])
}
