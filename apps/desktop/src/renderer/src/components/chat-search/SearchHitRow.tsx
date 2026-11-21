import type { MessageHit } from '../../lib/messageSearch'
import { formatMessageTime, messagePreview } from '../../lib/format'
import { Avatar } from '../Avatar'

/**
 * One message hit: the chat it lives in, when it was sent and what it said. The
 * whole row is the button — picking it opens that chat at that message.
 */
export function SearchHitRow({
  hit,
  onOpen,
}: {
  hit: MessageHit
  onOpen: (hit: MessageHit) => void
}) {
  return (
    <button type="button" className="wx-search-hit" onClick={() => onOpen(hit)}>
      <Avatar
        className="wx-avatar"
        url={hit.chat.avatarUrl}
        name={hit.chat.title}
        colorId={hit.chat.id}
      />
      <span className="wx-search-hit__main">
        <span className="wx-search-hit__head">
          <span className="wx-search-hit__title">{hit.chat.title}</span>
          <span className="wx-search-hit__time">{formatMessageTime(hit.message.date)}</span>
        </span>
        <span className="wx-search-hit__text">{messagePreview(hit.message)}</span>
      </span>
    </button>
  )
}
