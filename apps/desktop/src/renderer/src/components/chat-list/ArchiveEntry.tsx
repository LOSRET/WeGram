import type { ChatSummary } from '@wegram/protocol'

import { ArchiveIcon } from '../Icon'

interface ArchiveEntryProps {
  chats: ChatSummary[]
  onOpen: () => void
}

/**
 * 已归档会话: the conversation list's first row — it scrolls with the rows instead of
 * being pinned above them, and ChatList rests the list one row down so it starts out
 * of view (the reader scrolls up to find it).
 *
 * It is a list of its own (TDLib's `chatListArchive`), so the row is a door, not a
 * collapsible header: the count on the right is everything waiting inside it. The
 * badge turns grey when every unread chat in there is muted, the same rule the
 * conversation rows follow.
 */
export function ArchiveEntry({ chats, onOpen }: ArchiveEntryProps) {
  const unread = chats.reduce((total, chat) => total + chat.unread, 0)
  const quiet =
    unread > 0 && chats.every((chat) => chat.unread === 0 || chat.muted)

  return (
    <div
      className="wx-chat-item wx-archive-entry"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen()
      }}
    >
      <span className="wx-archive-entry__icon">
        <ArchiveIcon size={22} />
      </span>
      <div className="wx-chat-item__main">
        <div className="wx-chat-item__row">
          <span className="wx-chat-item__title">已归档会话</span>
        </div>
        <div className="wx-chat-item__row">
          <span className="wx-chat-item__preview">{chats.length} 个会话</span>
          {unread > 0 ? (
            <span className={`wx-badge${quiet ? ' wx-badge--muted' : ''}`}>
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
