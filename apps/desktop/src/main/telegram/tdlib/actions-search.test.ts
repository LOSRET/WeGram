import { describe, expect, it } from 'vitest'

import { searchMessages } from './actions'
import type { ActionDeps } from './actions'
import type { TdObject } from './client'
import type { MapperContext } from './map/context'

function makeContext(): MapperContext {
  return {
    chatTitles: new Map(),
    chatAvatarUrls: new Map(),
    userAvatarUrls: new Map(),
    stickerSizes: new Map(),
    resolveUserName: async (userId) => 'user-' + userId,
    resolveChatTitle: async (chatId) => 'chat-' + chatId,
    prefetchUserAvatars: () => undefined,
  }
}

function makeDeps(respond: (method: TdObject) => TdObject | null): {
  deps: ActionDeps
  calls: TdObject[]
} {
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

function rawMessage(id: number, chatId: number, date: number, text: string): TdObject {
  return {
    id,
    chat_id: chatId,
    date,
    is_outgoing: false,
    sender_id: { _: 'messageSenderUser', user_id: 7 },
    content: { _: 'messageText', text: { _: 'formattedText', text } },
  }
}

function rawChat(id: number, title: string, kind: 'private' | 'group' | 'channel'): TdObject {
  const type =
    kind === 'private'
      ? { _: 'chatTypePrivate', user_id: id + 100 }
      : kind === 'channel'
        ? { _: 'chatTypeSupergroup', supergroup_id: id + 100, is_channel: true }
        : { _: 'chatTypeBasicGroup', basic_group_id: id + 100 }
  return { id, title, type, unread_count: 0, last_read_outbox_message_id: 0 }
}

const page = (messages: TdObject[], total: number, next: string): TdObject => ({
  total_count: total,
  next_offset: next,
  messages,
})

describe('searchMessages', () => {
  it('merges the private and group streams newest first and keeps their cursors', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'searchMessages') {
        const filter = (method.chat_type_filter as TdObject)._
        if (filter === 'searchMessagesChatTypeFilterPrivate') {
          return page([rawMessage(2, 10, 300, 'late')], 2, 'private-next')
        }
        return page([rawMessage(1, 20, 200, 'early')], 1, '')
      }
      if (method._ === 'getChat') {
        return Number(method.chat_id) === 10
          ? rawChat(10, 'Ada Lovelace', 'private')
          : rawChat(20, '前端周会', 'group')
      }
      return null
    })

    const result = await searchMessages(deps, { q: 'a', scope: 'chat', limit: 20 })

    expect(calls.filter((call) => call._ === 'searchMessages')).toHaveLength(2)
    expect(result.messages.map((message) => message.id)).toEqual([2, 1])
    expect(result.total).toBe(3)
    expect(result.cursor).toEqual({ private: 'private-next', group: '', channel: '' })
    expect(result.chats.map((chat) => chat.title)).toEqual(['Ada Lovelace', '前端周会'])
  })

  it('resumes only the streams a cursor still points at', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'searchMessages') return page([], 0, '')
      if (method._ === 'getChat') return rawChat(10, 'Ada Lovelace', 'private')
      return null
    })

    await searchMessages(deps, {
      q: 'a',
      scope: 'chat',
      limit: 20,
      cursor: { private: 'more', group: '', channel: '' },
    })

    const searches = calls.filter((call) => call._ === 'searchMessages')
    expect(searches).toHaveLength(1)
    expect(searches[0]).toMatchObject({ offset: 'more' })
  })

  it('asks only for channels in the channel scope', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'searchMessages') {
        return page([rawMessage(3, 30, 400, 'post')], 1, '')
      }
      if (method._ === 'getChat') return rawChat(30, 'WeGram 频道', 'channel')
      return null
    })

    const result = await searchMessages(deps, { q: 'post', scope: 'channel', limit: 20 })

    const searches = calls.filter((call) => call._ === 'searchMessages')
    expect(searches).toHaveLength(1)
    expect(searches[0]).toMatchObject({
      chat_type_filter: { _: 'searchMessagesChatTypeFilterChannel' },
      filter: { _: 'searchMessagesFilterEmpty' },
    })
    expect(result.chats.map((chat) => chat.kind)).toEqual(['channel'])
    expect(result.cursor.channel).toBe('')
  })
})
