import type { ChatSummary, Message } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapMessage } from '../map/message'
import { fetchChatSummary } from './chats'
import type { ActionDeps } from './deps'

export async function searchGlobal(
  deps: ActionDeps,
  input: { q: string; limit: number },
): Promise<ChatSummary[]> {
  const response = await deps.invoke({ _: 'searchChats', query: input.q, limit: input.limit })
  const ids: number[] = Array.isArray(response.chat_ids) ? response.chat_ids : []
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
  const rawMessages: TdObject[] = Array.isArray(response.messages) ? response.messages : []
  return Promise.all(rawMessages.map((raw) => mapMessage(deps.mapper, input.chatId, raw)))
}
