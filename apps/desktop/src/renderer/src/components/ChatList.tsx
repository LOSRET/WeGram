import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary } from '@wegram/protocol'
import { memo, useRef, type MouseEvent } from 'react'

import { Avatar } from './Avatar'
import { OverlayScrollbar } from './OverlayScrollbar'
import { PlusIcon, SearchIcon } from './Icon'
import { formatChatTime, previewSegments } from '../lib/format'

/**
 * Every row is exactly this tall (`--wx-list-item-h`), which is what lets the list
 * be virtualised without measuring a single element.
 */
const LIST_ITEM_H = 65
/** Rows kept painted outside the viewport, so a fast wheel scroll never shows white. */
const LIST_OVERSCAN = 8

interface ChatRowProps {
  chat: ChatSummary
  active: boolean
  onSelect: (chat: ChatSummary) => void
}

/**
 * One conversation row.
 *
 * Memoised, like `MessageRow`: the list re-renders on every keystroke in the search
 * field and on every incoming `evt:chats` batch, and most of those touches one chat
 * or none. The props are kept referentially stable by the caller for this to bite.
 */
const ChatRow = memo(function ChatRow({ chat, active, onSelect }: ChatRowProps) {
  return (
    <div
      className={`wx-chat-item${active ? ' wx-chat-item--active' : ''}${
        !active && chat.pinned ? ' wx-chat-item--pinned' : ''
      }`}
      onClick={() => onSelect(chat)}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect(chat)
      }}
    >
      <Avatar className="wx-avatar" url={chat.avatarUrl} name={chat.title} colorId={chat.id} />
      <div className="wx-chat-item__main">
        <div className="wx-chat-item__row">
          <span className="wx-chat-item__title">{chat.title}</span>
          <span className="wx-chat-item__time">{formatChatTime(chat.lastMessageAt)}</span>
        </div>
        <div className="wx-chat-item__row">
          <span className="wx-chat-item__preview">
            {previewSegments(chat.lastMessageText ?? '', chat.lastMessageSpoilers).map(
              (segment, index) =>
                segment.spoiler ? (
                  <span key={index} className="wx-spoiler wx-spoiler--preview">
                    {segment.text}
                  </span>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
            )}
          </span>
          {chat.unread > 0 ? (
            <span className={`wx-badge${chat.muted ? ' wx-badge--muted' : ''}`}>
              {chat.unread > 99 ? '99+' : chat.unread}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
})

interface ChatListProps {
  chats: ChatSummary[]
  activeChatId: number | null
  query: string
  onQueryChange: (value: string) => void
  onSelect: (chat: ChatSummary) => void
  /** The header's circular "+" — opens the new-chat menu under the button. */
  onOpenPlus: (anchor: { x: number; y: number }) => void
}

/**
 * Middle column: search field, "new" button and the conversation rows.
 *
 * The rows are virtualised for the same reason the transcript is: the list is one
 * page away from growing past a screenful (`chats:list` already asks for 100), and
 * a full re-render of every row on each `evt:chats` batch is the difference between
 * a smooth wheel and a stutter. Rows are fixed-height, so no measurement pass.
 */
export function ChatList({
  chats,
  activeChatId,
  query,
  onQueryChange,
  onSelect,
  onOpenPlus,
}: ChatListProps) {
  // The scrolling view and the box that hosts the floating scrollbar (the
  // latter must be positioned; see `.wx-list__body`).
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ITEM_H,
    overscan: LIST_OVERSCAN,
    getItemKey: (index) => chats[index]?.id ?? index,
  })

  const openPlus = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    // WeChat hangs the card centred under the round button, 12 px below it.
    onOpenPlus({ x: rect.left + rect.width / 2, y: rect.bottom + 12 })
  }

  return (
    <section className="wx-list" aria-label="会话列表">
      <div className="wx-list__head">
        <label className="wx-search">
          <SearchIcon size={15} />
          <input
            value={query}
            placeholder="搜索"
            spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </label>
        <button
          className="wx-list__plus"
          title="更多"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={openPlus}
        >
          <PlusIcon size={24} />
        </button>
      </div>

      <div className="wx-list__body" ref={bodyRef}>
        <div className="wx-list__view" ref={scrollRef} data-testid="chat-scroller">
          {chats.length === 0 ? (
            <div className="wx-list__empty">{query ? '没有找到相关聊天' : '还没有会话'}</div>
          ) : (
            <div className="wx-list__sizer" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((virtualItem) => {
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
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <OverlayScrollbar scrollerRef={scrollRef} hostRef={bodyRef} />
      </div>
    </section>
  )
}
