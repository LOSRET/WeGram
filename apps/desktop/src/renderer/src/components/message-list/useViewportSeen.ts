import type { Virtualizer } from '@tanstack/react-virtual'
import type { Message } from '@wegram/protocol'
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import type { TranscriptRow } from './rows'
import { pickSeenUpTo } from './seen'
import { countUnreadBelow } from './unreadBelow'

/**
 * One measurement pass over the rendered rows answers both questions the
 * transcript has about the viewport: how far the read marker may move (the newest
 * row that has been on screen), and which row is the last one above the fold (the
 * pill counts what is left below it). A single definition of "seen" — a row whose
 * top edge is inside the viewport — instead of two that drift apart.
 *
 * Runs after every commit, so a row that grew (`measureElement`, an image
 * finishing) is covered as well: geometry decides, not the scroll event.
 */
export function useViewportSeen({
  rows,
  lastMessageIndexOfRow,
  messages,
  lastReadInboxMessageId,
  scrollRef,
  contentRef,
  virtualizer,
  onSeenUpToChange,
}: {
  rows: readonly TranscriptRow[]
  /** Row index → index of that row's last message (the album translation table). */
  lastMessageIndexOfRow: readonly number[]
  messages: readonly Message[]
  lastReadInboxMessageId: number | null
  scrollRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
  onSeenUpToChange: (messageId: number | null) => void
}): { measureViewport: () => void; buoy: number } {
  const [seenIndex, setSeenIndex] = useState(-1)
  /** How far the reader has actually read, in message ids (see `lib/readGate.ts`). */
  const seenUpToRef = useRef<number | null>(null)

  const measureViewport = useCallback(() => {
    const scroller = scrollRef.current
    const sizer = contentRef.current
    if (!scroller || !sizer) return

    const { newestIndex, newestId } = pickSeenUpTo({
      items: virtualizer.getVirtualItems(),
      /**
       * The sizer sits inside the scroller's own padding, and the padding scrolls
       * with the content: this one difference is "top padding - scrollTop", which
       * is what turns a row's `start` into its distance from the viewport's top.
       * Two rect reads per commit instead of one per rendered row.
       */
      sizerOffset: sizer.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      viewportHeight: scroller.clientHeight,
      // The row's last message is the newest thing it shows: an album on screen is
      // already read up to its last item.
      idAt: (index) => {
        const items = rows[index]?.messages
        return items?.[items.length - 1]?.id
      },
    })

    // The pill and the read marker count messages; the virtualiser counts rows.
    const seenMessageIndex = newestIndex >= 0 ? (lastMessageIndexOfRow[newestIndex] ?? -1) : -1
    setSeenIndex((previous) => (previous === seenMessageIndex ? previous : seenMessageIndex))
    if (newestId !== seenUpToRef.current) {
      seenUpToRef.current = newestId
      onSeenUpToChange(newestId)
    }
  }, [rows, lastMessageIndexOfRow, onSeenUpToChange, scrollRef, contentRef, virtualizer])

  useLayoutEffect(() => {
    measureViewport()
  })

  return { measureViewport, buoy: countUnreadBelow(messages, lastReadInboxMessageId, seenIndex) }
}
