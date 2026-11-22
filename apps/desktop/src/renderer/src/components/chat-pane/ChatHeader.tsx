import type { PeerStatus } from '@wegram/protocol'

import { formatPeerStatus } from '../../lib/presence'
import { CallIcon, CallMenuIcon, MoreIcon } from '../Icon'

interface ChatHeaderProps {
  title: string
  /** The peer is typing right now (the store expires the flag itself). */
  typing: boolean
  /**
   * 在线 / 最后上线 of a private chat's peer. Absent for groups and channels, and
   * while TDLib has no status to report — the title simply has no second line.
   */
  peerStatus?: PeerStatus | null
  /** The 聊天信息 panel is showing; the "…" button is its switch. */
  infoOpen: boolean
  onToggleInfo: () => void
  /**
   * 资料卡: private chats only. The title itself is the way in, like WeChat's,
   * where tapping the name opens that person's card — a group has no single
   * person to describe, so it gets no handler.
   */
  onOpenProfile?: () => void
}

/**
 * Conversation title bar. WeChat keeps the call buttons permanently disabled in
 * this build (there is no call stack yet), so they are rendered as such rather
 * than hidden — the header's rhythm depends on them being there.
 *
 * The private chat's second line is Telegram's idea, placed where WeChat's header
 * has room for it: under the name, inside the same 48 px band, so the transcript
 * never re-flows when it appears or disappears. Typing wins over status — both
 * describe the same person and a typing peer is the more immediate fact.
 */
export function ChatHeader({
  title,
  typing,
  peerStatus,
  infoOpen,
  onToggleInfo,
  onOpenProfile,
}: ChatHeaderProps) {
  const faces = (
    <>
      <span className="wx-chat__name">{title}</span>
      {typing ? (
        <span className="wx-chat__typing">对方正在输入…</span>
      ) : peerStatus ? (
        <span className="wx-chat__status">{formatPeerStatus(peerStatus, Date.now())}</span>
      ) : null}
    </>
  )
  return (
    <header className="wx-chat__header">
      {onOpenProfile ? (
        <button
          type="button"
          className="wx-chat__title wx-chat__title--clickable"
          title="查看资料"
          onClick={onOpenProfile}
        >
          {faces}
        </button>
      ) : (
        <h1 className="wx-chat__title">{faces}</h1>
      )}
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
          aria-expanded={infoOpen}
          onClick={onToggleInfo}
        >
          <MoreIcon size={18} />
        </button>
      </div>
    </header>
  )
}
