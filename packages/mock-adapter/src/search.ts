import { AppError } from '@wegram/protocol'
import type { ChatSummary, Message, SearchMessagesCursor } from '@wegram/protocol'

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

/**
 * Cross-chat hits for the search panel's 聊天 / 频道 tabs. The fixture account is
 * small, so one merged stream per scope is enough; the cursor is its numeric
 * offset, handed back in the field the real adapter would have used for that
 * scope. `total` is what the panel prints as "找到 N 条消息".
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
  const needle = input.q.trim().toLowerCase()
  const wantChannel = input.scope === 'channel'
  const key = wantChannel ? 'channel' : 'private'
  const offset = Number.parseInt(input.cursor?.[key] ?? '0', 10) || 0

  const hits: { chat: ChatSummary; message: Message }[] = []
  for (const fixture of fixtures.values()) {
    if ((fixture.chat.kind === 'channel') !== wantChannel) continue
    for (const message of fixture.messages) {
      if (message.text.toLowerCase().includes(needle)) {
        hits.push({ chat: fixture.chat, message })
      }
    }
  }
  hits.sort((a, b) => b.message.date - a.message.date || b.message.id - a.message.id)

  const page = hits.slice(offset, offset + input.limit)
  const next = offset + input.limit < hits.length ? String(offset + input.limit) : ''
  return {
    messages: page.map((hit) => hit.message),
    chats: [...new Map(page.map((hit) => [hit.chat.id, hit.chat])).values()].map((chat) => ({
      ...chat,
    })),
    total: hits.length,
    cursor: {
      private: wantChannel ? '' : next,
      group: '',
      channel: wantChannel ? next : '',
    },
  }
}
