import type { ChatSummary } from '@wegram/protocol'

import { Avatar } from './Avatar'
import { Modal } from './Modal'

interface ForwardDialogProps {
  /** The sheet's heading; 分享表情包 reuses this picker for a pack's link. */
  title?: string
  chats: ChatSummary[]
  /**
   * A chat the action cannot target — 转发 disables the conversation the message
   * came from and labels it 当前会话. 分享 a pack link may name any chat, so it
   * leaves this out.
   */
  disabledChatId?: number
  onForward: (toChatId: number) => void
  onClose: () => void
}

/** WeChat's "转发到" sheet: a chat picker with a hairline footer. */
export function ForwardDialog({
  title = '转发到',
  chats,
  disabledChatId,
  onForward,
  onClose,
}: ForwardDialogProps) {
  return (
    <Modal className="wx-modal--forward" label={title} onClose={onClose}>
      <div className="wx-forward-head">
        <span>{title}</span>
        <button className="wx-icon-button" onClick={onClose} title="关闭">
          ×
        </button>
      </div>

      <div className="wx-forward-list">
        {chats.map((chat) => (
          <button
            key={chat.id}
            className="wx-forward-item"
            onClick={() => onForward(chat.id)}
            disabled={chat.id === disabledChatId}
          >
            <Avatar className="wx-avatar" name={chat.title} colorId={chat.id} />
            <span className="wx-forward-item__title">{chat.title}</span>
            {chat.id === disabledChatId ? <span className="wx-hint">当前会话</span> : null}
          </button>
        ))}
      </div>

      <div className="wx-dialog__actions wx-dialog__actions--flat">
        <button onClick={onClose}>取消</button>
      </div>
    </Modal>
  )
}
