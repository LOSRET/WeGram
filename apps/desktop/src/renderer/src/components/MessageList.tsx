import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary, Message } from '@wechatgram/protocol'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'

import {
  avatarColor,
  formatDaySeparator,
  formatMessageTime,
  initials,
  isSameDay,
  messagePreview,
} from '../lib/format'
import { invoke } from '../lib/ipc'
import { useAnchoredScroll } from '../lib/useAnchoredScroll'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { MediaBubble } from './MediaBubble'
import { RichText } from './RichText'
import { StickerRenderer } from './StickerRenderer'
import { useAppStore } from '../store/useAppStore'
import type { UnreadMarker } from '../store/useAppStore'

interface MessageListProps {
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
  const contentRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  const prependingRef = useRef(false)
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

  /**
   * Rule 1, extended for #2: the first paint either restores the saved reading
   * position or lands at the bottom. Both happen while the list is still hidden
   * (`wx-messages--pending`), so the reader never sees it jump.
   *
   * The virtualizer measures rows lazily, so a single `scrollToIndex` is only an
   * estimate; the position is corrected against the anchor row's DOM node until
   * it stops moving — the same two-stage idea as the prepend compensation.
   */
  const restoringRef = useRef(false)
  const initialisedRef = useRef(false)

  const restoreToAnchor = async (messageId: number, offset: number): Promise<void> => {
    const el = scrollRef.current
    if (!el) return
    restoringRef.current = true
    unpin()
    try {
      let index = messages.findIndex((message) => message.id === messageId)
      if (index < 0) return
      virtualizer.scrollToIndex(index, { align: 'start' })

      let stable = 0
      for (let frame = 0; frame < 40 && stable < 2; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        if (!scrollRef.current) return
        index = messages.findIndex((message) => message.id === messageId)
        if (index < 0) return
        const node = el.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
        if (!node) {
          // Row is outside the rendered window (estimate was off): nudge again.
          virtualizer.scrollToIndex(index, { align: 'start' })
          stable = 0
          continue
        }
        const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top - offset
        if (Math.abs(delta) > 0.5) {
          el.scrollTop += delta
          stable = 0
        } else {
          stable += 1
        }
      }
    } finally {
      restoringRef.current = false
    }
  }

  useLayoutEffect(() => {
    if (initialisedRef.current || messages.length === 0) return
    initialisedRef.current = true

    const anchor = initialAnchor
    if (anchor && messages.some((message) => message.id === anchor.messageId)) {
      void restoreToAnchor(anchor.messageId, anchor.offset).finally(markReady)
      return
    }

    scrollToBottom()
    // Open the ready gate on the next frame, but never depend on it alone:
    // requestAnimationFrame is throttled while the window is occluded, and the
    // list must not stay invisible because of that. No cleanup cancels these:
    // StrictMode runs mount effects twice and its cleanup would kill the frame
    // scheduled by the pass that actually initialised the list.
    let opened = false
    const finish = (): void => {
      if (opened) return
      opened = true
      scrollToBottom()
      markReady()
    }
    requestAnimationFrame(finish)
    window.setTimeout(finish, 150)
    // Runs once per mounted chat (MessageList is keyed by chat id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

  /* ---------- reading position saved to ui.db (#2) ---------- */

  const lastSavedRef = useRef('')
  const saveTimerRef = useRef<number | null>(null)

  const measureAnchor = (): { messageId: number | null; offset: number } | null => {
    const el = scrollRef.current
    if (!el) return null
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    // At (or within a hair of) the bottom: no anchor at all is the two-in-one
    // "read to the end" flag — reopening lands on the newest message.
    if (distance <= 40) return { messageId: null, offset: 0 }
    const containerTop = el.getBoundingClientRect().top
    const slot = [...el.querySelectorAll<HTMLElement>('.wx-message-slot')].find(
      (node) => node.getBoundingClientRect().bottom > containerTop + 4,
    )
    const id = slot?.dataset['messageId']
    if (!slot || !id) return null
    return {
      messageId: Number(id),
      offset: Math.round(slot.getBoundingClientRect().top - containerTop),
    }
  }

  const flushAnchor = (): void => {
    if (!initialisedRef.current || restoringRef.current || prependingRef.current) return
    const anchor = measureAnchor()
    if (!anchor) return
    const key = `${anchor.messageId ?? 'bottom'}:${anchor.offset}`
    if (key === lastSavedRef.current) return
    lastSavedRef.current = key
    void invoke('ui:saveAnchor', {
      chatId: chat.id,
      messageId: anchor.messageId,
      offset: anchor.offset,
    }).catch(() => undefined)
  }

  const scheduleAnchorSave = (): void => {
    if (!initialisedRef.current || restoringRef.current || prependingRef.current) return
    if (saveTimerRef.current !== null) return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      flushAnchor()
    }, 250)
  }

  // Leaving the chat (or the window): write the last position immediately.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      flushAnchor()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const items: MenuItem[] = [{ label: '回复', onSelect: () => onReply(message) }]
    if (message.text) items.push({ label: '复制', onSelect: () => onCopy(message) })
    items.push({ label: '转发', onSelect: () => onForward(message) })
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
                {virtualItem.index === unreadIndex ? (
                  <div className="wx-unread-divider">
                    <span>以下是新消息</span>
                  </div>
                ) : null}
                {newDay ? <div className="wx-day-separator">{formatDaySeparator(message.date)}</div> : null}
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

/**
 * Id of the first message the reader had not seen when opening the chat.
 *
 * The read marker is authoritative; the unread counter is only a fallback for
 * chats whose marker is missing (e.g. a brand-new session). Returns null when
 * the divider would not make sense.
 */
function findUnreadMessage(messages: Message[], marker: UnreadMarker | null): number | null {
  if (!marker || marker.unread <= 0 || messages.length === 0) return null
  if (marker.lastReadInboxMessageId !== null) {
    const found = messages.find(
      (message) => !message.outgoing && message.id > marker.lastReadInboxMessageId!,
    )
    return found?.id ?? null
  }
  const fallback = messages[Math.max(0, messages.length - marker.unread)]
  return fallback?.id ?? null
}

interface MessageRowProps {
  chat: ChatSummary
  message: Message
  repliedTo: Message | null
  /** Identity of the signed-in account, for the avatar on our own messages. */
  self: { id: number; name: string }
  /** Highest outgoing id the peer has read; drives the 已读/未读 receipt. */
  readOutboxMaxId: number
  onOpenMenu: (x: number, y: number) => void
}

function MessageRow({ chat, message, repliedTo, self, readOutboxMaxId, onOpenMenu }: MessageRowProps) {
  if (message.kind === 'service') {
    return <div className="wx-service">{message.text || '系统消息'}</div>
  }

  const showSender = !message.outgoing && chat.kind !== 'private'
  const media = message.media
  const mediaKind =
    message.kind === 'photo' || message.kind === 'video' || message.kind === 'file' || message.kind === 'voice'
      ? message.kind
      : null
  const isSticker = message.kind === 'sticker' && media

  const openMenu = (event: MouseEvent): void => {
    event.preventDefault()
    onOpenMenu(event.clientX, event.clientY)
  }

  const readReceipt = message.outgoing
    ? readOutboxMaxId >= message.id
      ? ' · 已读'
      : ' · 未读'
    : ''

  return (
    <div className={`wx-message-row${message.outgoing ? ' wx-message-row--self' : ''}`}>
      <div
        className="wx-avatar wx-avatar--small"
        style={{
          background: avatarColor(
            message.outgoing
              ? (self.id ?? 1000)
              : message.senderChatId || message.senderId || chat.id,
          ),
        }}
      >
        {initials(message.outgoing ? self.name : message.senderName)}
      </div>

      <div className={`wx-message-stack${message.outgoing ? ' wx-message-stack--self' : ''}`}>
        {showSender && message.senderName && message.senderName !== self.name ? (
          <span className="wx-sender">{message.senderName}</span>
        ) : null}
        {isSticker ? (
          <div className="wx-sticker-wrap" onContextMenu={openMenu}>
            <StickerRenderer media={media!} size={140} />
          </div>
        ) : (
          <div
            className={`wx-bubble${message.outgoing ? ' wx-bubble--self' : ''}${
              mediaKind ? ` wx-bubble--media wx-bubble--${mediaKind}` : ''
            }`}
            onContextMenu={openMenu}
          >
            {repliedTo ? (
              <div className="wx-quote">
                {repliedTo.senderName}：{messagePreview(repliedTo)}
              </div>
            ) : null}
            {mediaKind && media ? <MediaBubble media={media} kind={mediaKind} /> : null}
            {message.text ? (
              <div className={mediaKind ? 'wx-caption' : undefined}>
                <RichText text={message.text} entities={message.entities} />
              </div>
            ) : null}
            {!mediaKind && !message.text ? <span className="wx-bubble__empty">[不支持的消息]</span> : null}
          </div>
        )}
        <span className="wx-message__meta">
          {formatMessageTime(message.date)}
          {message.edited ? ' · 已编辑' : ''}
          {readReceipt}
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
