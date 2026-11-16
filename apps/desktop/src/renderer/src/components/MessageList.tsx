import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary, Message } from '@wechatgram/protocol'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { avatarColor, formatMessageTime, initials } from '../lib/format'
import { useAnchoredScroll } from '../lib/useAnchoredScroll'
import { ContextMenu, type MenuItem } from './ContextMenu'

interface MessageListProps {
  chat: ChatSummary
  messages: Message[]
  hasMore: boolean
  loadingOlder: boolean
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

export function MessageList({
  chat,
  messages,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onCopy,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  const prependingRef = useRef(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [buoy, setBuoy] = useState(0)

  const { ready, atBottom, markReady, scrollToBottom } = useAnchoredScroll({
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

  // Rule 1: land at the bottom, and only reveal once that is true.
  useLayoutEffect(() => {
    if (ready || messages.length === 0) return
    scrollToBottom()
    const frame = requestAnimationFrame(() => {
      scrollToBottom()
      markReady()
    })
    return () => cancelAnimationFrame(frame)
  }, [messages.length, ready, scrollToBottom, markReady])

  // Buoy for messages that arrived while the reader is scrolled up (rule 3).
  const previousCount = useRef(messages.length)
  useEffect(() => {
    const previous = previousCount.current
    previousCount.current = messages.length
    if (messages.length > previous && !atBottom && !prependingRef.current) {
      setBuoy((count) => count + (messages.length - previous))
    }
    if (atBottom && buoy !== 0) setBuoy(0)
  }, [messages.length, atBottom, buoy])

  /**
   * Rule 2: keep the row the reader is looking at under the same pixel.
   *
   * Two stages, in this order:
   *  1. rough compensation by height delta, repeated for a few frames — the
   *     virtualizer remeasures prepended rows over time, so one pass is not
   *     enough to bring the anchor row back into the rendered window;
   *  2. exact correction against the anchor row's DOM offset, until stable.
   *
   * Stage 2 alone cannot work: right after a prepend the anchor row is outside
   * the virtualizer's rendered window, so it has no DOM node to measure.
   */
  const captureSnapshot = (): { scrollHeight: number; scrollTop: number } | null => {
    const el = scrollRef.current
    return el ? { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop } : null
  }

  const captureAnchor = (): { id: string; offset: number } | null => {
    const el = scrollRef.current
    if (!el) return null
    const containerTop = el.getBoundingClientRect().top
    const slot = [...el.querySelectorAll<HTMLElement>('.wx-message-slot')].find(
      (node) => node.getBoundingClientRect().top >= containerTop + 8,
    )
    const id = slot?.dataset['messageId']
    if (!slot || !id) return null
    return { id, offset: slot.getBoundingClientRect().top - containerTop }
  }

  const restorePosition = async (
    snapshot: { scrollHeight: number; scrollTop: number },
    anchor: { id: string; offset: number } | null,
  ): Promise<void> => {
    const el = scrollRef.current
    if (!el) return

    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const target = snapshot.scrollTop + (el.scrollHeight - snapshot.scrollHeight)
      if (Math.abs(target - el.scrollTop) > 0.5) el.scrollTop = target
    }

    if (!anchor) return
    let stable = 0
    for (let frame = 0; frame < 30 && stable < 2; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const node = el.querySelector<HTMLElement>(`[data-message-id="${anchor.id}"]`)
      if (!node) {
        stable = 0
        continue
      }
      const offset = node.getBoundingClientRect().top - el.getBoundingClientRect().top
      const delta = offset - anchor.offset
      if (Math.abs(delta) > 0.5) {
        el.scrollTop += delta
        stable = 0
      } else {
        stable += 1
      }
    }

    // Report the outcome for the dev acceptance panel (PerfPanel) and for
    // debugging: how far the anchored row ended up from where it started.
    const finalNode = el.querySelector<HTMLElement>(`[data-message-id="${anchor.id}"]`)
    const finalOffset = finalNode
      ? finalNode.getBoundingClientRect().top - el.getBoundingClientRect().top
      : Number.NaN
    el.dataset['anchorId'] = anchor.id
    el.dataset['anchorVisible'] = finalNode ? '1' : '0'
    el.dataset['anchorDelta'] = Number.isFinite(finalOffset)
      ? (finalOffset - anchor.offset).toFixed(1)
      : 'NaN'
  }

  const loadOlder = async (): Promise<void> => {
    if (loadingRef.current || !hasMore) return
    loadingRef.current = true
    prependingRef.current = true
    const snapshot = captureSnapshot()
    const anchor = captureAnchor()
    try {
      await onLoadOlder()
    } finally {
      if (snapshot) await restorePosition(snapshot, anchor)
      window.setTimeout(() => {
        loadingRef.current = false
        prependingRef.current = false
      }, 200)
    }
  }

  const menuItems = (message: Message): MenuItem[] => {
    const items: MenuItem[] = [
      { label: '回复', onSelect: () => onReply(message) },
      { label: '复制', onSelect: () => onCopy(message) },
      { label: '转发', onSelect: () => onForward(message) },
    ]
    if (message.outgoing && message.kind === 'text') {
      items.push({ label: '编辑', onSelect: () => onEdit(message) })
    }
    items.push({ label: '删除', danger: true, onSelect: () => onDelete(message) })
    return items
  }

  return (
    <div className="wx-messages-wrap">
      <div
        className={`wx-messages${ready ? '' : ' wx-messages--pending'}`}
        ref={scrollRef}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 160) void loadOlder()
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
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                data-message-id={message.id}
                ref={virtualizer.measureElement}
                className="wx-message-slot"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <MessageRow
                  chat={chat}
                  message={message}
                  quoted={
                    message.replyToId
                      ? (messages.find((item) => item.id === message.replyToId)?.text ?? null)
                      : null
                  }
                  onOpenMenu={(x, y) => setMenu({ message, x, y })}
                />
              </div>
            )
          })}
        </div>
      </div>

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

interface MessageRowProps {
  chat: ChatSummary
  message: Message
  quoted: string | null
  onOpenMenu: (x: number, y: number) => void
}

function MessageRow({ chat, message, quoted, onOpenMenu }: MessageRowProps) {
  const showSender = !message.outgoing && chat.kind !== 'private'

  return (
    <div className={`wx-message-row${message.outgoing ? ' wx-message-row--self' : ''}`}>
      {!message.outgoing ? (
        <div
          className="wx-avatar wx-avatar--small"
          style={{ background: avatarColor(message.senderChatId || message.senderId || chat.id) }}
        >
          {initials(message.senderName)}
        </div>
      ) : null}

      <div className={`wx-message-stack${message.outgoing ? ' wx-message-stack--self' : ''}`}>
        {showSender ? <span className="wx-sender">{message.senderName}</span> : null}
        <div
          className={`wx-bubble${message.outgoing ? ' wx-bubble--self' : ''}`}
          onContextMenu={(event) => {
            event.preventDefault()
            onOpenMenu(event.clientX, event.clientY)
          }}
        >
          {quoted ? <div className="wx-quote">{quoted.slice(0, 120)}</div> : null}
          {message.kind === 'text' ? message.text : `[${message.kind}] ${message.text}`.trim()}
        </div>
        <span className="wx-message__meta">
          {formatMessageTime(message.date)}
          {message.edited ? ' · 已编辑' : ''}
        </span>
      </div>

      <button
        className="wx-message-more"
        title="更多"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onOpenMenu(rect.left, rect.bottom + 4)
        }}
      >
        ⋯
      </button>
    </div>
  )
}
