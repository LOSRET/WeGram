import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary, Message } from '@wegram/protocol'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { isSameDay } from '../../lib/format'
import { useAnchoredScroll } from '../../lib/useAnchoredScroll'
import { useAppStore } from '../../store/useAppStore'
import type { UnreadMarker } from '../../store/useAppStore'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { JumpToLatestIcon } from '../Icon'
import { OverlayScrollbar } from '../OverlayScrollbar'
import { DaySeparator, UnreadDivider } from './Divider'
import { MessageRow } from './MessageRow'
import { buildMessageMenuItems } from './menu'
import { countUnreadBelow } from './unreadBelow'
import { useScrollFlags } from './scrollFlags'
import { findUnreadMessage, type LandingPosition } from './unread'
import { useAnchorSave } from './useAnchorSave'
import { useInitialPosition } from './useInitialPosition'
import { usePrependRestore } from './usePrependRestore'

export interface MessageListProps {
  chat: ChatSummary
  messages: Message[]
  hasMore: boolean
  loadingOlder: boolean
  /** Where the chat opens: saved row, unread divider, or (null) the newest message. */
  landing: LandingPosition | null
  /**
   * The newest message whose row has been on screen, or null before the first
   * measurement. The pane reports `messages:read` up to it: only the list knows
   * what the reader actually saw, and a chat left scrolled up must stay unread.
   */
  onSeenUpToChange: (messageId: number | null) => void
  /** What was unread when the chat was opened, for the "以下是新消息" divider. */
  unreadMarker: UnreadMarker | null
  onLoadOlder: () => Promise<void>
  onReply: (message: Message) => void
  onEdit: (message: Message) => void
  onDelete: (message: Message) => void
  onForward: (message: Message) => void
  onCopy: (message: Message) => void
}

interface MenuState {
  message: Message
  x: number
  y: number
}

/**
 * The virtualised transcript.
 *
 * This component owns the DOM and the render tree only. The three timing problems
 * that used to be interleaved with it live in their own hooks, because each one is
 * a separate bug class:
 *
 *   `useInitialPosition`  — where the list lands on first paint (anchor or bottom)
 *                           and the "never hide the content" safety nets
 *   `usePrependRestore`   — prepending older pages without moving the reader's row
 *   `useAnchorSave`       — writing the reading position back to `ui.db`
 *
 * Read `scroller.ts` before writing any `scrollTop` here: a programmatic scroll
 * must be followed by a scroll event, or the virtualizer paints the wrong slice.
 */
export function MessageList({
  chat,
  messages,
  hasMore,
  loadingOlder,
  landing,
  unreadMarker,
  onSeenUpToChange,
  onLoadOlder,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onCopy,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const auth = useAppStore((state) => state.auth)
  const self =
    auth.kind === 'ready'
      ? {
          id: auth.me.id,
          name: [auth.me.firstName, auth.me.lastName].filter(Boolean).join(''),
        }
      : { id: 1000, name: '我' }

  // Captured once per mounted chat: the divider must not jump as the read marker
  // moves after `chats:open`. Stored as an id, not an index, because prepending
  // older messages shifts indexes.
  const [unreadMessageId] = useState<number | null>(() => findUnreadMessage(messages, unreadMarker))
  const unreadIndex = unreadMessageId
    ? messages.findIndex((message) => message.id === unreadMessageId)
    : -1

  const flags = useScrollFlags()

  const { ready, atBottom, markReady, scrollToBottom, unpin, syncPin } = useAnchoredScroll({
    scrollRef,
    contentRef,
    resetKey: chat.id,
    restoringRef: flags.restoring,
  })

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 10,
    getItemKey: (index) => messages[index]?.id ?? index,
  })

  useInitialPosition({
    scrollRef,
    messages,
    landing,
    flags,
    virtualizer,
    ready,
    markReady,
    scrollToBottom,
    unpin,
    syncPin,
  })

  const { scheduleAnchorSave, savePosition } = useAnchorSave({ chatId: chat.id, scrollRef, flags })

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
  useEffect(() => {
    if (!ready || landing === null || flags.restoring.current) return
    if (landing.kind === 'unread') {
      if (atBottom) scheduleAnchorSave()
      else savePosition({ messageId: landing.messageId, offset: 0 })
      return
    }
    if (!atBottom) return
    scheduleAnchorSave()
    // `flags` itself is a fresh object per render; the ref inside it is stable.
  }, [ready, atBottom, landing, scheduleAnchorSave, savePosition, flags.restoring])

  const { loadOlder } = usePrependRestore({
    scrollRef,
    messages,
    hasMore,
    ready,
    flags,
    onLoadOlder,
  })

  /**
   * The pill's N is "how many new messages are still below the fold", derived from
   * the same read marker the chat row and the rail badge come from — not a counter
   * of arrivals. That is what keeps the three numbers agreeing: our own
   * `messages:read` moves the marker, the server answers with the new unread count,
   * and the pill follows. See `components/message-list/unreadBelow.ts`.
   */
  const [seenIndex, setSeenIndex] = useState(-1)
  const buoy = countUnreadBelow(messages, chat.lastReadInboxMessageId ?? null, seenIndex)

  /** How far the reader has actually read, in message ids (see `lib/readGate.ts`). */
  const seenUpToRef = useRef<number | null>(null)

  /**
   * One measurement pass over the rendered rows answers both questions the
   * transcript has about the viewport: how far the read marker may move (the newest
   * row that has been on screen), and which row is the last one above the fold (the
   * pill counts what is left below it). A single definition of "seen" — a row whose
   * top edge is inside the viewport — instead of two that drift apart.
   */
  const measureViewport = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return

    const viewport = scroller.getBoundingClientRect()
    const height = scroller.clientHeight
    let newestSeen = seenUpToRef.current
    let newestSeenIndex = -1

    for (const slot of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const top = slot.getBoundingClientRect().top - viewport.top
      if (top >= height) continue
      const index = Number(slot.dataset.index)
      const message = messages[index]
      if (!message) continue
      if (index > newestSeenIndex) newestSeenIndex = index
      if (newestSeen === null || message.id > newestSeen) newestSeen = message.id
    }

    if (newestSeenIndex !== seenIndex) setSeenIndex(newestSeenIndex)
    if (newestSeen !== seenUpToRef.current) {
      seenUpToRef.current = newestSeen
      onSeenUpToChange(newestSeen)
    }
  }, [messages, onSeenUpToChange, seenIndex, scrollRef])

  // Runs after every commit, so a row that grew (`measureElement`, an image
  // finishing) is covered as well: geometry decides, not the scroll event.
  useLayoutEffect(() => {
    measureViewport()
  })

  const menuItems = (message: Message): MenuItem[] =>
    buildMessageMenuItems(message, { onReply, onCopy, onForward, onEdit, onDelete })

  return (
    <div className="wx-messages-wrap" ref={hostRef}>
      <div
        className={`wx-messages${ready ? '' : ' wx-messages--pending'}`}
        ref={scrollRef}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 160) void loadOlder()
          measureViewport()
          scheduleAnchorSave()
        }}
        data-testid="message-scroller"
      >
        <div
          className="wx-messages__sizer"
          ref={contentRef}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const message = messages[virtualItem.index]
            if (!message) return null
            const previous = messages[virtualItem.index - 1]
            const newDay = !previous || !isSameDay(previous.date, message.date)
            const repliedTo = message.replyToId
              ? (messages.find((item) => item.id === message.replyToId) ?? null)
              : null
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                data-message-id={message.id}
                ref={virtualizer.measureElement}
                className="wx-message-slot"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {virtualItem.index === unreadIndex ? <UnreadDivider /> : null}
                {newDay ? <DaySeparator seconds={message.date} /> : null}
                <MessageRow
                  chat={chat}
                  message={message}
                  repliedTo={repliedTo}
                  self={self}
                  readOutboxMaxId={chat.lastReadOutboxMessageId ?? 0}
                  onOpenMenu={(x, y) => setMenu({ message, x, y })}
                />
              </div>
            )
          })}
        </div>
      </div>

      <OverlayScrollbar scrollerRef={scrollRef} hostRef={hostRef} hidden={!ready} />

      {loadingOlder ? <div className="wx-messages__loading">正在加载更早的消息…</div> : null}

      {/*
        WeChat's pill belongs to "the reader is not at the newest message", not to
        new arrivals: reopening a chat at a saved position (or at the unread
        divider) leaves the reader stranded without it. The counter only changes
        the wording — and it counts the arrivals still below the viewport, never
        the ones already read.
      */}
      {ready && !atBottom ? (
        <button className="wx-buoy" onClick={() => scrollToBottom(true)}>
          <JumpToLatestIcon className="wx-buoy__icon" />
          <span>{buoy > 0 ? `${buoy} 条新消息` : '跳转到最新消息'}</span>
        </button>
      ) : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.message)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}
