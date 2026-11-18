import { describe, expect, it } from 'vitest'

import { history, openChat } from './actions'
import type { ActionDeps } from './actions'
import type { TdObject } from './client'
import type { MapperContext } from './map/context'

function makeContext(): MapperContext {
  return {
    chatTitles: new Map(),
    chatAvatarUrls: new Map(),
    userAvatarUrls: new Map(),
    stickerSizes: new Map(),
    resolveUserName: async (userId) => `user-${userId}`,
    resolveChatTitle: async (chatId) => `chat-${chatId}`,
    prefetchUserAvatars: () => undefined,
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
  it('loads the chat without marking it read', async () => {
    const { deps, calls } = makeDeps((method) =>
      method._ === 'getChat' ? { id: 1, last_message: { id: 900, date: 1 } } : null,
    )

    await openChat(deps, 1)

    /**
     * Reading is reported per viewport by the renderer (`messages:read`). A read
     * request here zeroed a 300-unread group on the click, before the transcript
     * had landed on its "以下是新消息" line — the badge, the rail total and the
     * reader's other devices all said "read" while the unread block was on screen.
     */
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
