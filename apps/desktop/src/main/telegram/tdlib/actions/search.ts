import type { ChatSummary, Message, SearchMessagesCursor } from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import { mapMessage } from '../map/message'
import { fetchChatSummary } from './chats'
import type { ActionDeps } from './deps'

export async function searchGlobal(
  deps: ActionDeps,
  input: { q: string; limit: number },
): Promise<ChatSummary[]> {
  const response = await deps.invoke({ _: 'searchChats', query: input.q, limit: input.limit })
  const ids: number[] = asArray<number>(response.chat_ids)
  return Promise.all(ids.map((id) => fetchChatSummary(deps, id)))
}

export async function searchInChat(
  deps: ActionDeps,
  input: { chatId: number; q: string; fromMessageId?: number },
): Promise<Message[]> {
  const response = await deps.invoke({
    _: 'searchChatMessages',
    chat_id: input.chatId,
    query: input.q,
    sender_id: null,
    from_message_id: input.fromMessageId ?? 0,
    offset: 0,
    limit: 50,
    filter: { _: 'searchMessagesFilterEmpty' },
  })
  const rawMessages: TdObject[] = asArray(response.messages)
  return Promise.all(rawMessages.map((raw) => mapMessage(deps.mapper, input.chatId, raw)))
}

/**
 * One TDLib `searchMessages` stream. 聊天 is two streams by design: TDLib's
 * chat-type filter takes one type at a time, and private chats and groups are
 * different types, so the panel's 聊天 tab merges both.
 */
interface SearchStream {
  key: keyof SearchMessagesCursor
  filter: TdObject
}

const CHAT_STREAMS: readonly SearchStream[] = [
  { key: 'private', filter: { _: 'searchMessagesChatTypeFilterPrivate' } },
  { key: 'group', filter: { _: 'searchMessagesChatTypeFilterGroup' } },
]

const CHANNEL_STREAMS: readonly SearchStream[] = [
  { key: 'channel', filter: { _: 'searchMessagesChatTypeFilterChannel' } },
]

/**
 * Message text across chats (design doc §9.2). The body of each result row lives
 * in the message; the chat summary rides along in `chats` so the renderer can
 * draw the avatar and title without a second IPC round trip.
 */
export async function searchMessages(
  deps: ActionDeps,
  input: {
    q: string
    scope: 'chat' | 'channel'
    limit: number
    cursor?: SearchMessagesCursor
  },
): Promise<{
  messages: Message[]
  chats: ChatSummary[]
  total: number
  cursor: SearchMessagesCursor
}> {
  const streams = input.scope === 'channel' ? CHANNEL_STREAMS : CHAT_STREAMS
  const next: SearchMessagesCursor = { private: '', group: '', channel: '' }

  const pages = await Promise.all(
    streams.map(async (stream) => {
      const offset = input.cursor?.[stream.key] ?? ''
      // An empty offset after the first page is TDLib saying "no more": asking
      // again would restart from the newest page instead of continuing.
      if (input.cursor !== undefined && offset === '') {
        return { raw: [] as TdObject[], total: 0 }
      }
      const response = await deps.invoke({
        _: 'searchMessages',
        chat_list: { _: 'chatListMain' },
        query: input.q,
        offset,
        limit: input.limit,
        filter: { _: 'searchMessagesFilterEmpty' },
        chat_type_filter: stream.filter,
        min_date: 0,
        max_date: 0,
      })
      next[stream.key] = typeof response.next_offset === 'string' ? response.next_offset : ''
      return {
        raw: asArray<TdObject>(response.messages),
        // TDLib documents -1 when the total is unknown; it must not eat the sum.
        total:
          typeof response.total_count === 'number' && response.total_count > 0
            ? response.total_count
            : 0,
      }
    }),
  )

  const rawMessages = pages.flatMap((page) => page.raw)
  const chatIds = [...new Set(rawMessages.map((raw) => Number(raw.chat_id)))]
  const chats = await Promise.all(chatIds.map((chatId) => fetchChatSummary(deps, chatId)))
  deps.prefetchChatAvatars(chatIds)

  const messages = await Promise.all(
    rawMessages.map((raw) => mapMessage(deps.mapper, Number(raw.chat_id), raw)),
  )
  // The 聊天 tab merges two independently ordered streams into one the reader
  // can scan top-down: newest first, ties by id.
  messages.sort((a, b) => b.date - a.date || b.id - a.id)

  return {
    messages,
    chats,
    total: pages.reduce((sum, page) => sum + page.total, 0),
    cursor: next,
  }
}
