import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary, Message } from '@wechatgram/protocol'
import { useEffect, useRef, useState } from 'react'

import { isSameDay } from '../../lib/format'
import { useAnchoredScroll } from '../../lib/useAnchoredScroll'
import { useAppStore } from '../../store/useAppStore'
import type { UnreadMarker } from '../../store/useAppStore'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { OverlayScrollbar } from '../OverlayScrollbar'
import { DaySeparator, UnreadDivider } from './Divider'
import { MessageRow } from './MessageRow'
import { buildMessageMenuItems } from './menu'
import { useScrollFlags } from './scrollFlags'
import { findUnreadMessage } from './unread'
import { useAnchorSave } from './useAnchorSave'
import { useInitialPosition } from './useInitialPosition'
import { usePrependRestore } from './usePrependRestore'

export interface MessageListProps {
  chat: ChatSummary
  messages: Message[]
  hasMore: boolean
  loadingOlder: boolean
  /** Saved reading position to open the chat at; null means "land at the bottom". */
  initialAnchor: { messageId: number; offset: number } | null
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
  initialAnchor,
  unreadMarker,
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
  const [buoy, setBuoy] = useState(0)

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

  const { ready, atBottom, markReady, scrollToBottom, unpin } = useAnchoredScroll({
    scrollRef,
    contentRef,
    resetKey: chat.id,
  })

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 10,
    getItemKey: (index) => messages[index]?.id ?? index,
  })

  const flags = useScrollFlags()

  useInitialPosition({
    scrollRef,
    messages,
    initialAnchor,
    flags,
    virtualizer,
    ready,
    markReady,
    scrollToBottom,
    unpin,
  })

  const { scheduleAnchorSave } = useAnchorSave({ chatId: chat.id, scrollRef, flags })

  const { loadOlder } = usePrependRestore({
    scrollRef,
    messages,
    hasMore,
    ready,
    flags,
    onLoadOlder,
  })

  // Buoy for messages that arrived while the reader is scrolled up (rule 3).
  const previousCount = useRef(messages.length)
  useEffect(() => {
    const previous = previousCount.current
    previousCount.current = messages.length
    if (messages.length > previous && !atBottom && !flags.prepending.current) {
      setBuoy((count) => count + (messages.length - previous))
    }
    if (atBottom && buoy !== 0) setBuoy(0)
  }, [messages.length, atBottom, buoy, flags.prepending])

  const menuItems = (message: Message): MenuItem[] =>
    buildMessageMenuItems(message, { onReply, onCopy, onForward, onEdit, onDelete })

  return (
    <div className="wx-messages-wrap" ref={hostRef}>
      <div
        className={`wx-messages${ready ? '' : ' wx-messages--pending'}`}
        ref={scrollRef}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 160) void loadOlder()
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

      {buoy > 0 ? (
        <button
          className="wx-buoy"
          onClick={() => {
            scrollToBottom(true)
            setBuoy(0)
          }}
        >
          ↓ {buoy} 条新消息
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
