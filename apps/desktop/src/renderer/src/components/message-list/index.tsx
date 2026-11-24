import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary, Message, MessageProperties } from '@wegram/protocol'
import { useCallback, useMemo, useRef, useState } from 'react'

import { isSameDay } from '../../lib/format'
import { invoke } from '../../lib/ipc'
import { selfIdentity } from '../../lib/self'
import { useAnchoredScroll } from '../../lib/useAnchoredScroll'
import { useAppStore } from '../../store/useAppStore'
import type { UnreadMarker } from '../../store/useAppStore'
import { ContextMenu } from '../ContextMenu'
import { JumpToLatestIcon } from '../Icon'
import { OverlayScrollbar } from '../OverlayScrollbar'
import { ReportDialog } from '../ReportDialog'
import { DaySeparator, UnreadDivider } from './Divider'
import { MessageRow } from './MessageRow'
import { buildMessageMenuItems } from './menu'
import { findRowIndex, groupMessages } from './rows'
import { senderAvatarUrl } from './senderAvatar'
import { messagesById } from './seen'
import { findUnreadMessage, type LandingPosition } from './unread'
import { useAnchorSave } from './useAnchorSave'
import { useInitialPosition } from './useInitialPosition'
import { useJumpToLatest } from './useJumpToLatest'
import { useLandingSave } from './useLandingSave'
import { useLocateScroll } from './useLocateScroll'
import { usePrependRestore } from './usePrependRestore'
import { useScrollFlags } from './scrollFlags'
import { useViewportSeen } from './useViewportSeen'

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
  /**
   * The LIVE read markers of this transcript — the topic's own pair while a topic
   * is open, otherwise the chat's (`transcriptReadMarkers`). The buoy and the
   * 已读/未读 receipt derive from them with the same rules a flat chat uses;
   * `unreadMarker` above stays the open-time snapshot only the divider reads.
   */
  readInboxMessageId: number | null
  /** Highest outgoing id the members have read (话题: inside that topic). */
  readOutboxMessageId: number
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
  onDelete: (message: Message, forBoth: boolean) => void
  onForward: (message: Message) => void
  onCopy: (message: Message) => void
  /** Opens the full-pane comment view of the message (design doc §9.8). */
  onOpenComments: (message: Message) => void
  /** 重试 a message TDLib marked `failed` with `can_retry`. */
  onResend: (message: Message) => void
  /** 转文字: ask for a voice note's transcript. */
  onTranscribe: (message: Message) => void
  /** 贴纸: clicking a sticker opens the box of the pack it belongs to (§8.5). */
  onOpenStickerSet: (setId: string) => void
  /** A `/command` in a message: sends it to the chat, like the official client. */
  onBotCommand: (command: string) => void
  /** 置顶消息: the id this chat has pinned, so the menu can say 取消置顶. */
  pinnedMessageId: number | null
  onTogglePin: (message: Message) => void
}

interface MenuState {
  message: Message
  x: number
  y: number
  /** null when `messages:properties` failed; the menu then keeps safe items only. */
  properties: MessageProperties | null
}

/**
 * The virtualised transcript.
 *
 * This component owns the DOM and the render tree only. The timing problems that
 * used to be interleaved with it live in their own hooks, because each one is a
 * separate bug class:
 *
 *   `useInitialPosition`  — where the list lands on first paint (anchor or bottom)
 *                           and the "never hide the content" safety nets
 *   `usePrependRestore`   — prepending older pages without moving the reader's row
 *   `useAnchorSave`       — writing the reading position back to `ui.db`
 *   `useLandingSave`      — recording a landing that no scroll event will report
 *   `useJumpToLatest`     — following a latest-window reload to its end
 *   `useLocateScroll`     — 定位到聊天位置: scroll to the row, then flash it
 *   `useViewportSeen`     — the one "seen" measurement (read marker + buoy)
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
  readInboxMessageId,
  readOutboxMessageId,
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
  onOpenComments,
  onResend,
  onTranscribe,
  onOpenStickerSet,
  onBotCommand,
  pinnedMessageId,
  onTogglePin,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** 举报: the row whose phased report sheet is open (one message at a time). */
  const [report, setReport] = useState<Message | null>(null)
  /** Guards a properties answer that lands after closing or re-opening the menu. */
  const menuRequest = useRef(0)

  const auth = useAppStore((state) => state.auth)
  // Photos of people that finished downloading after their rows were mapped
  // (`evt:avatars`), plus whatever the row itself already carried.
  const userAvatars = useAppStore((state) => state.userAvatars)
  // Memoised because every rendered row takes it as a prop: a fresh object per
  // render would re-render all of them and defeat `memo` in `MessageRow`.
  const self = useMemo(() => selfIdentity(auth), [auth])

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

  useLandingSave({
    ready,
    landing,
    atBottom,
    hasNewer,
    restoring: flags.restoring,
    scheduleAnchorSave,
    savePosition,
  })

  useJumpToLatest({ chatId: chat.id, scrollRef, virtualizer, scrollToBottom })

  const flashId = useLocateScroll({ located, rows, scrollRef, virtualizer })

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
   * the same read marker the row it belongs to comes from — not a counter of
   * arrivals. That is what keeps the numbers agreeing: our own `messages:read`
   * moves the marker, the server answers with the new unread count, and the pill
   * follows. A topic passes its own markers (design doc §9.12), so a read topic
   * stops counting against the forum's General marker. See
   * `components/message-list/unreadBelow.ts`.
   */
  const { measureViewport, buoy } = useViewportSeen({
    rows,
    lastMessageIndexOfRow,
    messages,
    lastReadInboxMessageId: readInboxMessageId,
    scrollRef,
    contentRef,
    virtualizer,
    onSeenUpToChange,
  })

  /** One stable handler for every row: a fresh arrow per row defeats `memo`. */
  const openMenu = useCallback((message: Message, x: number, y: number): void => {
    const request = menuRequest.current + 1
    menuRequest.current = request
    const open = (properties: MessageProperties | null): void => {
      if (request === menuRequest.current) setMenu({ message, x, y, properties })
    }
    void invoke('messages:properties', { chatId: message.chatId, messageId: message.id })
      .then(open)
      .catch(() => open(null))
  }, [])

  const closeMenu = useCallback((): void => {
    menuRequest.current += 1
    setMenu(null)
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
                  readOutboxMaxId={readOutboxMessageId}
                  onOpenMenu={openMenu}
                  onOpenComments={onOpenComments}
                  onResend={onResend}
                  onOpenStickerSet={onOpenStickerSet}
                  onBotCommand={onBotCommand}
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
            {
              onReply,
              onCopy,
              onForward,
              onEdit,
              onDelete,
              onResend,
              onTranscribe,
              onTogglePin,
              onReport: (message) => setReport(message),
            },
            { canReply, properties: menu.properties, pinnedMessageId },
          )}
          onClose={closeMenu}
        />
      ) : null}

      {report ? (
        <ReportDialog
          target={{ kind: 'message', chatId: chat.id, messageId: report.id }}
          onClose={() => setReport(null)}
        />
      ) : null}
    </div>
  )
}
