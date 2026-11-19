import type { ChatSummary, Message } from '@wegram/protocol'

import { Avatar } from './Avatar'

interface ForwardDialogProps {
  chats: ChatSummary[]
  message: Message
  onForward: (toChatId: number) => void
  onClose: () => void
}

/** WeChat's "转发到" sheet: a chat picker with a hairline footer. */
export function ForwardDialog({ chats, message, onForward, onClose }: ForwardDialogProps) {
  return (
    <div className="wx-modal-backdrop" onClick={onClose}>
      <div className="wx-modal wx-modal--forward" onClick={(event) => event.stopPropagation()}>
        <div className="wx-forward-head">
          <span>转发到</span>
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
              disabled={chat.id === message.chatId}
            >
              <Avatar className="wx-avatar" name={chat.title} colorId={chat.id} />
              <span className="wx-forward-item__title">{chat.title}</span>
              {chat.id === message.chatId ? <span className="wx-hint">当前会话</span> : null}
            </button>
          ))}
        </div>

        <div className="wx-dialog__actions wx-dialog__actions--flat">
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}
