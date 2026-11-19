import type { Message } from '@wegram/protocol'

import type { AdapterEvent } from '../adapter'
import type { Fixture } from './constants'
import { appendMessage } from './transcript'

/**
 * One incoming message every 12 s, so the live paths (chat row preview, unread
 * badge, typing indicator) have something to show while the app sits open. The
 * 5000-message stress chat is skipped: it is for scrolling, not for arrivals.
 */
export function emitTraffic({
  ready,
  fixtures,
  userAvatarUrls,
  takeId,
  emit,
}: {
  ready: boolean
  fixtures: Map<number, Fixture>
  userAvatarUrls: Map<number, string>
  takeId: () => number
  emit: (event: AdapterEvent) => void
}): void {
  if (!ready) return
  const all = [...fixtures.values()].filter((fixture) => fixture.chat.id !== 99)
  const target = all[Math.floor(Math.random() * all.length)]
  if (!target) return

  const senderId = target.chat.id * 10 + 7
  const senderAvatarUrl = userAvatarUrls.get(senderId)
  const id = takeId()
  const message: Message = {
    id,
    chatId: target.chat.id,
    senderId,
    senderName: '对方',
    ...(senderAvatarUrl ? { senderAvatarUrl } : {}),
    outgoing: false,
    date: Math.floor(Date.now() / 1000),
    kind: 'text',
    text: `（mock）新消息 #${id + 1 - 5000}`,
  }
  appendMessage({ emit }, target, message, message.text, { unread: true })

  emit({
    type: 'typing',
    chatId: target.chat.id,
    userId: message.senderId,
    action: 'typing',
    until: Date.now() + 3000,
  })
}
