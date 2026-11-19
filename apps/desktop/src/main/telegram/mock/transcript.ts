import type { Message, MessageMedia } from '@wegram/protocol'

import type { AdapterEvent } from '../adapter'
import type { Fixture } from './constants'
import { ME } from './constants'

/**
 * The two steps every mock send shares: build the row this account posted, and
 * append it to a fixture the way TDLib announces one.
 *
 * The order inside `appendMessage` is load-bearing: the transcript op goes out
 * before the chat row's new preview, and a send path that forgets the second
 * event leaves the list showing the previous message.
 */

type Emit = (event: AdapterEvent) => void

export function outgoingMessage(input: {
  id: number
  chatId: number
  kind: Message['kind']
  text: string
  media?: MessageMedia
  replyTo?: number
}): Message {
  return {
    id: input.id,
    chatId: input.chatId,
    senderId: ME.id,
    senderName: '我',
    outgoing: true,
    date: Math.floor(Date.now() / 1000),
    kind: input.kind,
    text: input.text,
    ...(input.media ? { media: input.media } : {}),
    ...(input.replyTo === undefined ? {} : { replyToId: input.replyTo }),
  }
}

export function appendMessage(
  deps: { emit: Emit },
  fixture: Fixture,
  message: Message,
  /** What the conversation row shows under the title. */
  preview: string,
  options: { unread?: boolean } = {},
): void {
  fixture.messages.push(message)
  fixture.chat.lastMessageText = preview
  fixture.chat.lastMessageAt = message.date
  if (options.unread) fixture.chat.unread += 1
  deps.emit({ type: 'messages', chatId: message.chatId, ops: [{ op: 'new', message }] })
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
}
