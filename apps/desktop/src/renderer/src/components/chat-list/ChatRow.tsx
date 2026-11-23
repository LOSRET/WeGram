import type { ChatSummary } from '@wegram/protocol'
import { memo } from 'react'

import { Avatar } from '../Avatar'
import { formatChatTime, previewSegments } from '../../lib/format'
import { matchSegments } from '../../lib/search'

interface ChatRowProps {
  chat: ChatSummary
  active: boolean
  onSelect: (chat: ChatSummary) => void
  /** Right-click / long-press: the list's own menu (置顶/免打扰/未读/归档/删除). */
  onContextMenu: (chat: ChatSummary, x: number, y: number) => void
  /**
   * The normalised query while this row is a global-search hit: the matched run of
   * the title turns green. Undefined for a normal conversation row, which also
   * means a pinned chat keeps its tint (search hits never show one).
   */
  highlight?: string
}

/**
 * One conversation row, shared by the conversation list and 已归档会话's page.
 *
 * Memoised, like `MessageRow`: the list re-renders on every keystroke in the search
 * field and on every incoming `evt:chats` batch, and most of those touches one chat
 * or none. The props are kept referentially stable by the caller for this to bite.
 */
export const ChatRow = memo(function ChatRow({
  chat,
  active,
  onSelect,
  onContextMenu,
  highlight,
}: ChatRowProps) {
  return (
    <div
      className={`wx-chat-item${active ? ' wx-chat-item--active' : ''}${
        !active && !highlight && chat.pinned ? ' wx-chat-item--pinned' : ''
      }`}
      onClick={() => onSelect(chat)}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(chat, event.clientX, event.clientY)
      }}
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
          ) : chat.markedUnread ? (
            // 标为未读: a flag, not a count — WeChat draws a bare dot for it.
            <span
              className={`wx-badge--dot${chat.muted ? ' wx-badge--dot--muted' : ''}`}
              title="标为未读"
            />
          ) : null}
        </div>
      </div>
    </div>
  )
})
