import { AppError } from '@wegram/protocol'
import type { ChatSummary, Message } from '@wegram/protocol'

import type { Fixture } from './constants'

/**
 * The mock's two search paths (the real adapter uses TDLib's). Kept apart from
 * the adapter class: `mock/index.ts` is at its line budget, and this is a rule
 * of its own (title match over the chat list, substring over one transcript).
 */
export function searchChats(
  fixtures: Map<number, Fixture>,
  q: string,
  limit: number,
): ChatSummary[] {
  const needle = q.toLowerCase()
  return [...fixtures.values()]
    .map((fixture) => fixture.chat)
    .filter((chat) => chat.title.toLowerCase().includes(needle))
    .slice(0, limit)
}

export function searchMessages(
  fixtures: Map<number, Fixture>,
  input: { chatId: number; q: string; fromMessageId?: number },
): Message[] {
  const fixture = fixtures.get(input.chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${input.chatId}`)
  const needle = input.q.toLowerCase()
  return fixture.messages.filter((message) => message.text.toLowerCase().includes(needle))
}
