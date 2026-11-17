import { describe, expect, it } from 'vitest'

import { history, openChat } from './actions'
import type { ActionDeps } from './actions'
import type { TdObject } from './client'
import type { MapperContext } from './map/context'

function makeContext(): MapperContext {
  return {
    chatTitles: new Map(),
    chatAvatarUrls: new Map(),
    stickerSizes: new Map(),
    resolveUserName: async (userId) => `user-${userId}`,
    resolveChatTitle: async (chatId) => `chat-${chatId}`,
  }
}

type Responder = (method: TdObject) => TdObject | null

function makeDeps(respond: Responder): { deps: ActionDeps; calls: TdObject[] } {
  const calls: TdObject[] = []
  const deps: ActionDeps = {
    invoke: async (method) => {
      calls.push(method)
      return respond(method)
    },
    mapper: makeContext(),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    emit: () => undefined,
    prefetchChatAvatars: () => undefined,
  }
  return { deps, calls }
}

function rawMessage(id: number, text: string): TdObject {
  return {
    id,
    date: 1_700_000_000,
    is_outgoing: false,
    sender_id: { _: 'messageSenderUser', user_id: 7 },
    content: { _: 'messageText', text: { _: 'formattedText', text } },
  }
}

describe('openChat', () => {
  it('marks the chat read up to the last message the server knows', async () => {
    const { deps, calls } = makeDeps((method) =>
      method._ === 'getChat' ? { id: 1, last_message: { id: 900, date: 1 } } : null,
    )

    await openChat(deps, 1)

    // The newest id must come from `getChat`, not from a history page: the page
    // ends one message below the newest (from_message_id is exclusive).
    expect(calls.map((call) => call._)).toEqual(['getChat', 'viewMessages'])
    expect(calls[1]).toMatchObject({ chat_id: 1, message_ids: [900], force_read: true })
  })

  it('does not send a read request for a chat without messages', async () => {
    const { deps, calls } = makeDeps(() => ({ id: 2, last_message: null }))

    await openChat(deps, 2)

    expect(calls.map((call) => call._)).toEqual(['getChat'])
  })
})

describe('history', () => {
  it('anchors the first page one past last_message so the newest message is included', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getChat') return { id: 1, last_message: { id: 500, date: 1 } }
      if (method._ === 'getChatHistory') {
        return { messages: [rawMessage(500, 'newest'), rawMessage(499, 'older')] }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const page = await history(deps, { chatId: 1, limit: 2 })

    expect(page.messages.map((message) => message.id)).toEqual([499, 500])
    expect(calls.find((call) => call._ === 'getChatHistory')).toMatchObject({
      from_message_id: 501,
      limit: 2,
    })
  })

  it('passes an explicit fromMessageId through unchanged', async () => {
    const { deps, calls } = makeDeps(() => ({ messages: [rawMessage(499, 'older')] }))

    await history(deps, { chatId: 1, fromMessageId: 500, limit: 1 })

    // Paging back means "everything older than the oldest loaded row", so the
    // caller's id must stay exclusive.
    expect(calls[0]).toMatchObject({ _: 'getChatHistory', from_message_id: 500 })
  })
})
