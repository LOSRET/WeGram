import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary, Message } from '@wegram/protocol'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { isSameDay } from '../../lib/format'
import { useAnchoredScroll } from '../../lib/useAnchoredScroll'
import { useAppStore } from '../../store/useAppStore'
import type { UnreadMarker } from '../../store/useAppStore'
import { ContextMenu } from '../ContextMenu'
import { JumpToLatestIcon } from '../Icon'
import { OverlayScrollbar } from '../OverlayScrollbar'
import { DaySeparator, UnreadDivider } from './Divider'
import { MessageRow } from './MessageRow'
import { buildMessageMenuItems } from './menu'
import { findRowIndex, groupMessages } from './rows'
import { senderAvatarUrl } from './senderAvatar'
import { messagesById, pickSeenUpTo } from './seen'
import { countUnreadBelow } from './unreadBelow'
import { useScrollFlags } from './scrollFlags'
import { findUnreadMessage, type LandingPosition } from './unread'
import { useAnchorSave } from './useAnchorSave'
import { useInitialPosition } from './useInitialPosition'
import { usePrependRestore } from './usePrependRestore'
import { resyncScroller } from './scroller'

export interface MessageListProps {
  chat: ChatSummary
  messages: Message[]
  hasMore: boolean
  /** The window stops short of the newest message; scroll down or jump to extend it. */
  hasNewer: boolean
  loadingOlder: boolean
  /** Where the chat opens: saved row, unread divider, or (null) the newest message. */
  landing: LandingPosition | null
  /**
   * 定位到聊天位置: the row to scroll to and flash once (the viewer asked for it).
   * Already in `messages` — the pane loads a window around it first.
   */
  located: number | null
  /**
   * The newest message whose row has been on screen, or null before the first
   * measurement. The pane reports `messages:read` up to it: only the list knows
   * what the reader actually saw, and a chat left scrolled up must stay unread.
   */
  onSeenUpToChange: (messageId: number | null) => void
  /** What was unread when the chat was opened, for the "以下是新消息" divider. */
  unreadMarker: UnreadMarker | null
  onLoadOlder: () => Promise<void>
  /**
   * Keep one older page in hand (see `useChatHistory.prefetchOlder`). The list
   * calls it as soon as it is up and after every landing, so a scroll towards the
   * top finds history instead of a dead wait for TDLib.
   */
  onPrefetchOlder: () => void
  /** Extends an anchored window when the reader reaches its end. */
  onLoadNewer: () => void
  /** Replaces an anchored window with the newest page and scrolls to its end. */
  onReturnToLatest: () => Promise<void>
  /**
   * Whether a reply can be typed at all: a read-only channel has no composer, so
   * its menu must not offer 回复.
   */
  canReply: boolean
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
 *
 * The virtualiser counts **rows**, not messages: an album is one row of several
 * messages (design doc §8.6). Every "message index" the rest of this file keeps
 * (unread divider, seen marker, pill) is therefore translated from a row index.
 */
export function MessageList({
  chat,
  messages,
  hasMore,
  hasNewer,
  loadingOlder,
  landing,
  located,
  unreadMarker,
  onSeenUpToChange,
  onLoadOlder,
  onPrefetchOlder,
  onLoadNewer,
  onReturnToLatest,
  canReply,
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
  // Photos of people that finished downloading after their rows were mapped
  // (`evt:avatars`), plus whatever the row itself already carried.
  const userAvatars = useAppStore((state) => state.userAvatars)
  // Memoised because every rendered row takes it as a prop: a fresh object per
  // render would re-render all of them and defeat `memo` in `MessageRow`.
  const self = useMemo(
    () =>
      auth.kind === 'ready'
        ? {
            id: auth.me.id,
            name: [auth.me.firstName, auth.me.lastName].filter(Boolean).join(''),
            avatarUrl: auth.me.avatarUrl,
          }
        : { id: 1000, name: '我', avatarUrl: undefined },
    [auth],
  )

  /**
   * Albums folded into rows (design doc §8.6). Derived, never stored: a page that
   * arrives later changes the grouping by itself.
   */
  const rows = useMemo(() => groupMessages(messages), [messages])
  /**
   * Row index → index of that row's *last* message, i.e. the highest id the reader
   * has seen when the row came on screen. The pill and the read marker work in
   * message indexes, so this is the one translation table between the two.
   */
  const lastMessageIndexOfRow = useMemo(() => {
    let offset = 0
    return rows.map((row) => {
      offset += row.messages.length
      return offset - 1
    })
  }, [rows])

  // Captured once per mounted chat: the divider must not jump as the read marker
  // moves after the first `messages:read`. Stored as an id, not an index, because
  // prepending older messages shifts indexes.
  const [unreadMessageId] = useState<number | null>(() => findUnreadMessage(messages, unreadMarker))
  const unreadRowIndex = useMemo(
    () => (unreadMessageId === null ? -1 : findRowIndex(rows, unreadMessageId)),
    [rows, unreadMessageId],
  )

  /** Reply quotes are looked up per rendered row — build the index once per page. */
  const byId = useMemo(() => messagesById(messages), [messages])

  const flags = useScrollFlags()

  const { ready, atBottom, markReady, scrollToBottom, unpin, syncPin } = useAnchoredScroll({
    scrollRef,
    contentRef,
    resetKey: chat.id,
    restoringRef: flags.restoring,
  })

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 10,
    getItemKey: (index) => rows[index]?.key ?? index,
  })

  useInitialPosition({
    scrollRef,
    rows,
    landing,
    flags,
    virtualizer,
    ready,
    markReady,
    scrollToBottom,
    unpin,
    syncPin,
  })

  const { scheduleAnchorSave, savePosition } = useAnchorSave({
    chatId: chat.id,
    scrollRef,
    flags,
    anchoredWindow: hasNewer,
  })

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
      // "At the bottom" must mean the chat's bottom: an anchored window's end is
      // an arbitrary old row, and storing `null` there would discard the position.
      if (!hasNewer && atBottom) scheduleAnchorSave()
      else savePosition({ messageId: landing.messageId, offset: 0 })
      return
    }
    if (hasNewer || !atBottom) return
    scheduleAnchorSave()
    // `flags` itself is a fresh object per render; the ref inside it is stable.
  }, [ready, atBottom, hasNewer, landing, scheduleAnchorSave, savePosition, flags.restoring])

  /**
   * A latest-window reload replaces every row, so the viewport has to follow it to
   * the end. The signal is per chat and consumed by a mount-time ref: a tick meant
   * for another conversation must not move this one when it is mounted later.
   */
  const jumpToLatest = useAppStore((state) => state.jumpToLatest)
  const consumedJumpTick = useRef(jumpToLatest?.tick ?? 0)
  useEffect(() => {
    if (!jumpToLatest || jumpToLatest.chatId !== chat.id) return
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
  }, [jumpToLatest, chat.id, virtualizer, scrollToBottom])

  /**
   * 定位到聊天位置: one scroll to the requested row, then a flash that fades out by
   * itself (the list owns the timer; nothing outside knows the row is special).
   *
   * The rows array is read through a ref: a message arriving must not re-run the
   * scroll, or every arrival would yank the reader back to the located picture.
   */
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
  }, [located, virtualizer])

  const { loadOlder } = usePrependRestore({
    scrollRef,
    messages,
    hasMore,
    ready,
    flags,
    onLoadOlder,
    onPrefetchOlder,
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

  // Runs after every commit, so a row that grew (`measureElement`, an image
  // finishing) is covered as well: geometry decides, not the scroll event.
  useLayoutEffect(() => {
    measureViewport()
  })

  /** One stable handler for every row: a fresh arrow per row defeats `memo`. */
  const openMenu = useCallback((message: Message, x: number, y: number): void => {
    setMenu({ message, x, y })
  }, [])

  return (
    <div className="wx-messages-wrap" ref={hostRef}>
      <div
        className={`wx-messages${ready ? '' : ' wx-messages--pending'}`}
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget
          if (el.scrollTop < 160) void loadOlder()
          // The end of an anchored window is not the chat's end: keep reading
          // forward by appending the next page instead of stopping there.
          if (hasNewer && el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
            onLoadNewer()
          }
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
            const row = rows[virtualItem.index]
            if (!row) return null
            const first = row.messages[0]
            const last = row.messages[row.messages.length - 1]
            if (!first || !last) return null
            const previousRow = rows[virtualItem.index - 1]
            const previousLast = previousRow?.messages[previousRow.messages.length - 1]
            const newDay = !previousLast || !isSameDay(previousLast.date, first.date)
            // A map, not a `find` per row: this ran once per visible row on every
            // render, i.e. O(visible x transcript).
            const repliedTo = first.replyToId ? (byId.get(first.replyToId) ?? null) : null
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                data-message-id={first.id}
                data-row-key={row.key}
                ref={virtualizer.measureElement}
                className={`wx-message-slot${
                  flashId !== null && row.messages.some((message) => message.id === flashId)
                    ? ' is-located'
                    : ''
                }`}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {virtualItem.index === unreadRowIndex ? <UnreadDivider /> : null}
                {newDay ? <DaySeparator seconds={first.date} /> : null}
                <MessageRow
                  chat={chat}
                  messages={row.messages}
                  repliedTo={repliedTo}
                  self={self}
                  avatarUrl={senderAvatarUrl(first, chat, self, userAvatars)}
                  readOutboxMaxId={chat.lastReadOutboxMessageId ?? 0}
                  onOpenMenu={openMenu}
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
      {ready && (!atBottom || hasNewer) ? (
        <button
          className="wx-buoy"
          onClick={() => {
            // The handler reloads the newest page when needed and always asks
            // the list to scroll through the per-chat jump signal.
            void onReturnToLatest()
          }}
        >
          <JumpToLatestIcon className="wx-buoy__icon" />
          <span>{hasNewer || buoy === 0 ? '跳转到最新消息' : `${buoy} 条新消息`}</span>
        </button>
      ) : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMessageMenuItems(
            menu.message,
            { onReply, onCopy, onForward, onEdit, onDelete },
            { canReply },
          )}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}
