import { anchorOf, type PopupAnchor } from '../../lib/popupPlacement'
import { CallIcon, CallMenuIcon, MoreIcon } from '../Icon'

interface ChatHeaderProps {
  title: string
  /** The peer is typing right now (the store expires the flag itself). */
  typing: boolean
  /** Opens the chat-info popover against the "…" button. */
  onOpenInfo: (anchor: PopupAnchor) => void
}

/**
 * Conversation title bar. WeChat keeps the call buttons permanently disabled in
 * this build (there is no call stack yet), so they are rendered as such rather
 * than hidden — the header's rhythm depends on them being there.
 */
export function ChatHeader({ title, typing, onOpenInfo }: ChatHeaderProps) {
  return (
    <header className="wx-chat__header">
      <h1 className="wx-chat__title">
        {title}
        {typing ? <span className="wx-chat__typing">对方正在输入…</span> : null}
      </h1>
      <div className="wx-chat__header-actions">
        <button className="wx-ghost-btn" title="语音通话" disabled aria-label="语音通话">
          <CallMenuIcon size={19} />
        </button>
        <button className="wx-ghost-btn" title="视频通话" disabled aria-label="视频通话">
          <CallIcon size={18} />
        </button>
        <button
          className="wx-ghost-btn"
          title="聊天信息"
          aria-label="聊天信息"
          onClick={(event) => onOpenInfo(anchorOf(event.currentTarget.getBoundingClientRect()))}
        >
          <MoreIcon size={18} />
        </button>
      </div>
    </header>
  )
}
