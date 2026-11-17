import { describe, expect, it, vi } from 'vitest'

import type { MapperContext } from './context'
import { mapMessage } from './message'

/**
 * `mapMessage` is where a TDLib update becomes a transcript row. The sender
 * resolution is the part that has been wrong in production (channel posts showed
 * `未知`), and service messages need their text composed by us.
 */
function makeContext(overrides: Partial<MapperContext> = {}): MapperContext {
  return {
    chatTitles: new Map(),
    chatAvatarUrls: new Map(),
    stickerSizes: new Map(),
    resolveUserName: async (userId) => `user-${userId}`,
    resolveChatTitle: async (chatId) => `chat-${chatId}`,
    ...overrides,
  }
}

describe('mapMessage', () => {
  it('maps a user message field by field', async () => {
    const message = await mapMessage(makeContext(), 7, {
      id: 100,
      date: 1_700_000_000,
      sender_id: { _: 'messageSenderUser', user_id: 42 },
      is_outgoing: false,
      content: { _: 'messageText', text: { text: 'hello' } },
      reply_to: { message_id: 99 },
      edit_date: 1_700_000_100,
    })

    expect(message).toEqual({
      id: 100,
      chatId: 7,
      senderId: 42,
      senderName: 'user-42',
      outgoing: false,
      date: 1_700_000_000,
      kind: 'text',
      text: 'hello',
      replyToId: 99,
      edited: true,
    })
  })

  it('resolves a channel post through the chat title and keeps senderChatId', async () => {
    const message = await mapMessage(makeContext(), 8, {
      id: 1,
      date: 10,
      sender_id: { _: 'messageSenderChat', chat_id: 55 },
      is_outgoing: false,
      content: { _: 'messageText', text: { text: 'post' } },
    })

    expect(message.senderId).toBe(0)
    expect(message.senderChatId).toBe(55)
    expect(message.senderName).toBe('chat-55')
  })

  it('uses 未知 when there is no sender at all', async () => {
    const message = await mapMessage(makeContext(), 8, {
      id: 1,
      date: 10,
      content: { _: 'messageText', text: { text: 'anonymous' } },
    })

    expect(message.senderName).toBe('未知')
    expect(message).not.toHaveProperty('senderChatId')
  })

  it('composes the text of a service message, using the resolver for members', async () => {
    const resolveUserName = vi.fn(async (userId: number) => `member-${userId}`)
    const message = await mapMessage(makeContext({ resolveUserName }), 9, {
      id: 2,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 3 },
      is_outgoing: true,
      content: { _: 'messageChatAddMembers', member_user_ids: [11, 12] },
    })

    expect(message.kind).toBe('service')
    expect(message.text).toBe('你邀请member-11、member-12加入了群聊')
    // Sender resolution first, then the members of the service message.
    expect(resolveUserName.mock.calls.map(([id]) => id)).toEqual([3, 11, 12])
  })

  it('marks an unhandled content type as unsupported instead of rendering empty', async () => {
    const message = await mapMessage(makeContext(), 9, {
      id: 3,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 3 },
      content: { _: 'messageSomethingNew' },
    })

    expect(message.kind).toBe('service')
    expect(message.text).toBe('[暂不支持的消息]')
  })

  it('keeps caption entities on media messages', async () => {
    const message = await mapMessage(makeContext(), 9, {
      id: 4,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 3 },
      content: {
        _: 'messagePhoto',
        caption: {
          text: 'see **this**',
          entities: [{ type: { _: 'textEntityTypeBold' }, offset: 4, length: 4 }],
        },
        photo: { sizes: [{ width: 100, height: 100, photo: { id: 5 } }] },
      },
    })

    expect(message.kind).toBe('photo')
    expect(message.entities).toEqual([{ type: 'bold', offset: 4, length: 4 }])
    expect(message.media).toMatchObject({ fileId: 5 })
  })
})
