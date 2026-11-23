import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'

import { OverlayScrollbar } from '../OverlayScrollbar'
import { ArchiveBar } from './ArchiveBar'
import { ChatRow } from './ChatRow'
import { useChatAvatarPrefetch } from '../../lib/useChatAvatarPrefetch'
import { useChatPaging } from '../../lib/useChatPaging'
import { CHAT_ROW_H, LIST_OVERSCAN } from '../../lib/listMetrics'

interface ArchivePageProps {
  chats: ChatSummary[]
  activeChatId: number | null
  /** Drives the slide: the conversation list keeps the page mounted until it closed. */
  open: boolean
  onSelect: (chat: ChatSummary) => void
  onContextMenu: (chat: ChatSummary, x: number, y: number) => void
  onBack: () => void
}

/**
 * 已归档会话 (design doc §9.2), the page the conversation list's first row opens.
 *
 * It is an OVERLAY inside the conversation column: the page slides in from the
 * right over the list, which keeps its rows and its scroll position underneath.
 * That is what makes it a place you visit rather than a filter that re-flows the
 * list — and it is also why the archive has its own scroller and virtualiser.
 *
 * Mount closed, flip `is-open` on the next tick. The timeout is the fallback for
 * an occluded window, where rAF is throttled (renderer/AGENTS.md); the list
 * unmounts the page `ARCHIVE_PAGE_ANIM_MS` after the close, or the slide-out
 * would be cut off mid-flight.
 */
export function ArchivePage({
  chats,
  activeChatId,
  open,
  onSelect,
  onContextMenu,
  onBack,
}: ArchivePageProps) {
  const [entered, setEntered] = useState(false)
  // The scrolling view and the box that hosts the floating scrollbar.
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    const timer = window.setTimeout(() => setEntered(true), 20)
    return () => window.clearTimeout(timer)
  }, [open])

  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CHAT_ROW_H,
    overscan: LIST_OVERSCAN,
    getItemKey: (index) => chats[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const firstIndex = virtualItems[0]?.index ?? 0
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? -1

  // The archive is the second TDLib chat list, so it pages and prefetches photos
  // on exactly the same rules as the conversation list.
  const paging = useChatPaging('archive')
  const ensureLoaded = paging.ensureLoaded
  useEffect(() => {
    ensureLoaded(lastIndex, chats.length)
  }, [lastIndex, chats.length, ensureLoaded])
  useChatAvatarPrefetch(chats, firstIndex, lastIndex)

  return (
    <div className={`wx-archive-page${entered && open ? ' is-open' : ''}`}>
      <ArchiveBar count={chats.length} onBack={onBack} />
      <div className="wx-list__body" ref={bodyRef}>
        <div className="wx-list__view" ref={scrollRef} data-testid="archive-scroller">
          {chats.length === 0 ? (
            <div className="wx-list__empty">还没有已归档的会话</div>
          ) : (
            <div className="wx-list__sizer" style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((virtualItem) => {
                const chat = chats[virtualItem.index]
                if (!chat) return null
                return (
                  <div
                    key={virtualItem.key}
                    className="wx-list__slot"
                    data-index={virtualItem.index}
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <ChatRow
                      chat={chat}
                      active={chat.id === activeChatId}
                      onSelect={onSelect}
                      onContextMenu={onContextMenu}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <OverlayScrollbar scrollerRef={scrollRef} hostRef={bodyRef} />
      </div>
    </div>
  )
}
