import type { ChatSummary, Message } from '@wechatgram/protocol'

import { avatarColor, initials } from '../lib/format'

interface ForwardDialogProps {
  chats: ChatSummary[]
  message: Message
  onForward: (toChatId: number) => void
  onClose: () => void
}

export function ForwardDialog({ chats, message, onForward, onClose }: ForwardDialogProps) {
  return (
    <div className="wx-modal-backdrop" onClick={onClose}>
      <div className="wx-modal" onClick={(event) => event.stopPropagation()}>
        <div className="wx-modal__header">
          <span>转发到</span>
          <button className="wx-icon-button" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="wx-hint">
          消息：{message.text.slice(0, 40) || `[${message.kind}]`}
        </div>
        <div className="wx-forward-list">
          {chats.map((chat) => (
            <button
              key={chat.id}
              className="wx-forward-item"
              onClick={() => onForward(chat.id)}
              disabled={chat.id === message.chatId}
            >
              <span className="wx-avatar wx-avatar--small" style={{ background: avatarColor(chat.id) }}>
                {initials(chat.title)}
              </span>
              <span className="wx-forward-item__title">{chat.title}</span>
              {chat.id === message.chatId ? <span className="wx-hint">当前会话</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
