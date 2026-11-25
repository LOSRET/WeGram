import { searchChatRows, searchMessageRows, searchMessagesInScope as searchScope } from '@wegram/mock-session'
import { AppError } from '@wegram/protocol'
import type { ChatSummary, Message, SearchMessagesCursor } from '@wegram/protocol'

import type { Fixture } from './constants'

/**
 * The mock's two search paths (the real adapter uses TDLib's).
 *
 * The matching rules are `@wegram/mock-session`'s, because the browser preview
 * answers the same channels; this module only adapts the fixture map to them.
 * Kept apart from the adapter class: `index.ts` is at its line budget, and this
 * is a rule of its own.
 */
export function searchChats(
  fixtures: Map<number, Fixture>,
  q: string,
  limit: number,
): ChatSummary[] {
  return searchChatRows(
    [...fixtures.values()].map((fixture) => fixture.chat),
    q,
    limit,
  )
}

export function searchMessages(
  fixtures: Map<number, Fixture>,
  input: {
    chatId: number
    q: string
    filter?: 'photo' | 'video' | 'file' | 'url'
    fromMessageId?: number
  },
): Message[] {
  const fixture = fixtures.get(input.chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${input.chatId}`)
  return searchMessageRows(fixture.messages, input.q, input.filter)
}

/**
 * Cross-chat hits for the search panel's 聊天 / 频道 tabs: one merged stream per
 * scope, the numeric offset as its cursor. `total` is what the panel prints as
 * 找到 N 条消息.
 */
export function searchMessagesInScope(
  fixtures: Map<number, Fixture>,
  input: {
    q: string
    scope: 'chat' | 'channel'
    limit: number
    cursor?: SearchMessagesCursor
  },
): {
  messages: Message[]
  chats: ChatSummary[]
  total: number
  cursor: SearchMessagesCursor
} {
  return searchScope(
    [...fixtures.values()].map((fixture) => ({
      chat: fixture.chat,
      messages: fixture.messages,
    })),
    input,
  )
}
