import type { ChatSummary } from '@wechatgram/protocol'

import { Popup } from '../ContextMenu'
import { kindLabel } from './labels'

interface ChatInfoPopoverProps {
  chat: ChatSummary
  /** Messages currently in memory — a debugging aid, not a chat property. */
  loadedCount: number
  position: { x: number; y: number }
  onClose: () => void
}

/** The "…" popover: what this build knows about the conversation. */
export function ChatInfoPopover({ chat, loadedCount, position, onClose }: ChatInfoPopoverProps) {
  return (
    <Popup x={position.x} y={position.y} onClose={onClose}>
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
    </Popup>
  )
}
