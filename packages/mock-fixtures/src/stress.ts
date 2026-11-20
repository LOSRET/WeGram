import type { ChatSummary, Message } from '@wegram/protocol'

/**
 * The virtualised list's stress chat: 5000 messages in one conversation.
 *
 * Split out of `data.ts` when the custom-emoji fixture pushed that file to its
 * 550-line budget — it is a different concern from the demo account (it exists to
 * measure scrolling, not to demo the UI). Its ids start at 10 000 so they never
 * collide with the conversations `data.ts` builds.
 */
export interface StressSeed {
  chat: ChatSummary
  messages: Message[]
}

export function buildStressSeed(options: {
  selfId: number
  at: (minutesAgo: number) => number
}): StressSeed {
  const { selfId, at } = options
  const messages: Message[] = []
  for (let index = 0; index < 5000; index += 1) {
    const outgoing = index % 3 === 0
    messages.push({
      id: 10_000 + index,
      chatId: 99,
      senderId: outgoing ? selfId : 30 + (index % 5),
      senderName: outgoing ? '我' : '成员' + (index % 5),
      outgoing,
      date: at(600 - Math.floor(index / 10)),
      kind: 'text',
      text: '压测消息 #' + (index + 1) + '：这是一条用于验证虚拟滚动与锚定补偿的中等长度消息。',
    })
  }
  return {
    chat: {
      id: 99,
      title: '性能测试群 · 5000 条',
      kind: 'group',
      unread: 0,
      pinned: false,
      muted: true,
      lastMessageText: messages[messages.length - 1]?.text ?? '',
      lastMessageAt: at(0),
      lastReadInboxMessageId: 10_000 + messages.length - 1,
      lastReadOutboxMessageId: 0,
    },
    messages,
  }
}
