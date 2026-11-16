import type { ChatSummary } from '@wechatgram/protocol'

import { avatarColor, formatChatTime, initials } from '../lib/format'

interface ChatListProps {
  chats: ChatSummary[]
  activeChatId: number | null
  onSelect: (chat: ChatSummary) => void
}

export function ChatList({ chats, activeChatId, onSelect }: ChatListProps) {
  return (
    <aside className="wx-sidebar">
      {chats.length === 0 ? (
        <div className="wx-sidebar__empty">没有会话</div>
      ) : (
        chats.map((chat) => (
          <div
            key={chat.id}
            className={`wx-chat-item${chat.id === activeChatId ? ' wx-chat-item--active' : ''}`}
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
                <span className="wx-chat-item__time">{formatChatTime(chat.lastMessageAt)}</span>
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
        ))
      )}
    </aside>
  )
}
