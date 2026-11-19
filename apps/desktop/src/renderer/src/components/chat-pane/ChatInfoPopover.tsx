import type { ChatSummary } from '@wegram/protocol'

import type { PopupAnchor } from '../../lib/popupPlacement'
import { AnchoredPopup } from '../ContextMenu'
import { kindLabel } from './labels'

interface ChatInfoPopoverProps {
  chat: ChatSummary
  /** Messages currently in memory — a debugging aid, not a chat property. */
  loadedCount: number
  /** The "…" button the card hangs from, right-aligned to its edge. */
  anchor: PopupAnchor
  onClose: () => void
}

/** The "…" popover: what this build knows about the conversation. */
export function ChatInfoPopover({ chat, loadedCount, anchor, onClose }: ChatInfoPopoverProps) {
  return (
    <AnchoredPopup anchor={anchor} placement={{ align: 'right' }} onClose={onClose}>
      <div className="wx-info-pop__row">
        <span>名称</span>
        <strong>{chat.title}</strong>
      </div>
      <div className="wx-info-pop__row">
        <span>类型</span>
        <strong>{kindLabel(chat.kind)}</strong>
      </div>
      <div className="wx-info-pop__row">
        <span>未读</span>
        <strong>{chat.unread}</strong>
      </div>
      <div className="wx-info-pop__row">
        <span>已加载</span>
        <strong>{loadedCount} 条</strong>
      </div>
      <div className="wx-info-pop__row">
        <span>已读回执</span>
        <strong>{chat.lastReadOutboxMessageId ? `#${chat.lastReadOutboxMessageId}` : '无'}</strong>
      </div>
    </AnchoredPopup>
  )
}
