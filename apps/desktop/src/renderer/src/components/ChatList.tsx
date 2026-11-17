import type { ChatSummary } from '@wechatgram/protocol'
import { useRef, type MouseEvent } from 'react'

import { OverlayScrollbar } from './OverlayScrollbar'
import { PlusIcon, SearchIcon } from './Icon'
import { avatarColor, formatChatTime, initials } from '../lib/format'

interface ChatListProps {
  chats: ChatSummary[]
  activeChatId: number | null
  query: string
  onQueryChange: (value: string) => void
  onSelect: (chat: ChatSummary) => void
  /** The header's circular "+" — opens the new-chat menu under the button. */
  onOpenPlus: (anchor: { x: number; y: number }) => void
}

/** Middle column: search field, "new" button and the conversation rows. */
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
        <div className="wx-list__view" ref={scrollRef}>
          {chats.length === 0 ? (
            <div className="wx-list__empty">{query ? '没有找到相关聊天' : '还没有会话'}</div>
          ) : (
            chats.map((chat) => {
              const active = chat.id === activeChatId
              return (
                <div
                  key={chat.id}
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
                  <div className="wx-avatar" style={{ background: avatarColor(chat.id) }}>
                    {chat.avatarUrl ? (
                      <img
                        className="wx-avatar__img"
                        src={chat.avatarUrl}
                        alt=""
                        draggable={false}
                      />
                    ) : (
                      initials(chat.title)
                    )}
                  </div>
                  <div className="wx-chat-item__main">
                    <div className="wx-chat-item__row">
                      <span className="wx-chat-item__title">{chat.title}</span>
                      <span className="wx-chat-item__time">
                        {formatChatTime(chat.lastMessageAt)}
                      </span>
                    </div>
                    <div className="wx-chat-item__row">
                      <span className="wx-chat-item__preview">{chat.lastMessageText ?? ''}</span>
                      {chat.unread > 0 ? (
                        chat.muted ? (
                          <span className="wx-badge wx-badge--muted">•</span>
                        ) : (
                          <span className="wx-badge">{chat.unread > 99 ? '99+' : chat.unread}</span>
                        )
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
        <OverlayScrollbar scrollerRef={scrollRef} hostRef={bodyRef} />
      </div>
    </section>
  )
}
