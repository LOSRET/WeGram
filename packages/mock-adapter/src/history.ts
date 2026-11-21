import { pageAround, pageNewer, pageOlder } from '@wegram/mock-session'
import { AppError } from '@wegram/protocol'
import type { Message } from '@wegram/protocol'

import type { Fixture } from './constants'

/**
 * Transcript paging for the mock (design doc §6.3), split out of `index.ts` so the
 * adapter class stays inside its size budget.
 *
 * The paging rules themselves are `@wegram/mock-session`'s — the same functions
 * the browser preview runs — so this module only hands them the chat's rows and
 * copies the page: a caller must never mutate the fixture through a message it
 * got back from history.
 */
export interface MockHistoryStore {
  fixtures: Map<number, Fixture>
}

export interface MockHistoryQuery {
  chatId: number
  fromMessageId?: number
  limit: number
}

export interface MockAroundQuery {
  chatId: number
  messageId: number
  limit: number
}

export interface MockNewerQuery {
  chatId: number
  fromMessageId: number
  limit: number
}

function messagesOf(store: MockHistoryStore, chatId: number): Message[] {
  const fixture = store.fixtures.get(chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${chatId}`)
  return fixture.messages
}

function copy(messages: Message[]): Message[] {
  return messages.map((message) => ({ ...message }))
}

export function mockHistory(
  store: MockHistoryStore,
  input: MockHistoryQuery,
): { messages: Message[]; hasMore: boolean } {
  const page = pageOlder(messagesOf(store, input.chatId), input.fromMessageId, input.limit)
  return { messages: copy(page.messages), hasMore: page.hasMore }
}

export function mockHistoryAround(
  store: MockHistoryStore,
  input: MockAroundQuery,
): { messages: Message[]; hasMore: boolean; hasNewer: boolean } {
  const { messages, hasMore, hasNewer } = pageAround(
    messagesOf(store, input.chatId),
    input.messageId,
    input.limit,
  )
  return { messages: copy(messages), hasMore, hasNewer }
}

export function mockHistoryNewer(
  store: MockHistoryStore,
  input: MockNewerQuery,
): { messages: Message[]; hasNewer: boolean } {
  const { messages, hasNewer } = pageNewer(
    messagesOf(store, input.chatId),
    input.fromMessageId,
    input.limit,
  )
  return { messages: copy(messages), hasNewer }
}
