import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary } from '@wegram/protocol'
import { memo, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'

import { Avatar } from './Avatar'
import { OverlayScrollbar } from './OverlayScrollbar'
import { PlusIcon } from './Icon'
import { SearchField } from './SearchField'
import { formatChatTime, previewSegments } from '../lib/format'
import { CHAT_ROW_H, LIST_OVERSCAN } from '../lib/listMetrics'
import { matchSegments, normalizeQuery } from '../lib/search'
import { useGlobalSearch } from '../lib/useGlobalSearch'

interface ChatRowProps {
  chat: ChatSummary
  active: boolean
  onSelect: (chat: ChatSummary) => void
  /**
   * The normalised query while this row is a global-search hit: the matched run of
   * the title turns green. Undefined for a normal conversation row, which also
   * means a pinned chat keeps its tint (search hits never show one).
   */
  highlight?: string
}

/**
 * One conversation row.
 *
 * Memoised, like `MessageRow`: the list re-renders on every keystroke in the search
 * field and on every incoming `evt:chats` batch, and most of those touches one chat
 * or none. The props are kept referentially stable by the caller for this to bite.
 */
const ChatRow = memo(function ChatRow({ chat, active, onSelect, highlight }: ChatRowProps) {
  return (
    <div
      className={`wx-chat-item${active ? ' wx-chat-item--active' : ''}${
        !active && !highlight && chat.pinned ? ' wx-chat-item--pinned' : ''
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
          <span className="wx-chat-item__title">
            {highlight === undefined
              ? chat.title
              : matchSegments(chat.title, highlight).map((segment, index) =>
                  segment.hit ? (
                    <mark key={index} className="wx-chat-item__hit">
                      {segment.text}
                    </mark>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
          </span>
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
  /** A global-search hit: it may sit outside `chats`, so the shell resolves it itself. */
  onSelectHit: (chat: ChatSummary) => void
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
 *
 * When the pill has text the column swaps faces: the rows become the server's
 * global search hits (`search:global` → TDLib `searchChats`, design doc §9.2),
 * not a filter over the page already loaded. That face is at most one page of
 * hits, so it is drawn plainly; Esc or the pill's × brings the conversations back.
 */
export function ChatList({
  chats,
  activeChatId,
  query,
  onQueryChange,
  onSelect,
  onSelectHit,
  onOpenPlus,
}: ChatListProps) {
  // The scrolling view and the box that hosts the floating scrollbar (the
  // latter must be positioned; see `.wx-list__body`).
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const needle = normalizeQuery(query)
  const searching = needle !== ''
  const { hits, loading, error } = useGlobalSearch(query)

  // Both faces open at the top, and the virtualiser has to be told through a real
  // scroll event: a programmatic `scrollTop` write bypasses its own listener
  // (renderer/AGENTS.md).
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    scroller.scrollTop = 0
    scroller.dispatchEvent(new Event('scroll'))
  }, [searching])

  const virtualizer = useVirtualizer({
    count: searching ? 0 : chats.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CHAT_ROW_H,
    overscan: LIST_OVERSCAN,
    getItemKey: (index) => chats[index]?.id ?? index,
  })

  const openPlus = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    // WeChat hangs the card centred under the round button, 12 px below it.
    onOpenPlus({ x: rect.left + rect.width / 2, y: rect.bottom + 12 })
  }

  /** Esc clears the box before any window-level handler (the chat-info panel) sees it. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || !searching) return
    event.stopPropagation()
    onQueryChange('')
  }

  return (
    <section className="wx-list" aria-label="会话列表" onKeyDown={onKeyDown}>
      <div className="wx-list__head">
        <SearchField
          value={query}
          onValueChange={onQueryChange}
          guardPointer
          trailing={
            query !== '' ? (
              <button
                type="button"
                className="wx-search__clear"
                title="清除"
                aria-label="清除"
                onClick={() => onQueryChange('')}
              >
                ×
              </button>
            ) : undefined
          }
        />
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
          {searching ? (
            <div className="wx-list__hits">
              <div className="wx-list__hits-head">
                <span>聊天</span>
                {!loading && error === null && hits.length > 0 ? (
                  <span className="wx-list__hits-count">{hits.length}</span>
                ) : null}
              </div>
              {error !== null ? (
                <div className="wx-list__empty">{error}</div>
              ) : loading ? (
                <div className="wx-list__empty">正在搜索…</div>
              ) : hits.length === 0 ? (
                <div className="wx-list__empty">没有找到相关聊天</div>
              ) : (
                hits.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeChatId}
                    onSelect={onSelectHit}
                    highlight={needle}
                  />
                ))
              )}
            </div>
          ) : chats.length === 0 ? (
            <div className="wx-list__empty">还没有会话</div>
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
                    <ChatRow chat={chat} active={chat.id === activeChatId} onSelect={onSelect} />
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
