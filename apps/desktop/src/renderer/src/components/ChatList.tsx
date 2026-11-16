import type { ChatSummary } from '@wechatgram/protocol'
import type { MouseEvent } from 'react'

import { PlusIcon, SearchIcon } from './Icon'
import { avatarColor, formatChatTime, initials } from '../lib/format'

interface ChatListProps {
  chats: ChatSummary[]
  activeChatId: number | null
  query: string
  onQueryChange: (value: string) => void
  onSelect: (chat: ChatSummary) => void
  onOpenMenu: (anchor: { x: number; y: number }) => void
}

/** Middle column: search field, "new" button and the conversation rows. */
export function ChatList({
  chats,
  activeChatId,
  query,
  onQueryChange,
  onSelect,
  onOpenMenu,
}: ChatListProps) {
  const openMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    onOpenMenu({ x: rect.right - 4, y: rect.bottom + 4 })
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
          onClick={openMenu}
        >
          <PlusIcon size={24} />
        </button>
      </div>

      <div className="wx-list__body">
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
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelect(chat)
                }}
              >
                <div className="wx-avatar" style={{ background: avatarColor(chat.id) }}>
                  {initials(chat.title)}
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
    </section>
  )
}
