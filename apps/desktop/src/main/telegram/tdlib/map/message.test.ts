import { describe, expect, it, vi } from 'vitest'

import type { MapperContext } from './context'
import { mapMessage, mapReactions } from './message'

/**
 * `mapMessage` is where a TDLib update becomes a transcript row. The sender
 * resolution is the part that has been wrong in production (channel posts showed
 * `未知`), and service messages need their text composed by us.
 */
function makeContext(overrides: Partial<MapperContext> = {}): MapperContext {
  return {
    chatTitles: new Map(),
    chatAvatarUrls: new Map(),
    userAvatarUrls: new Map(),
    stickerSizes: new Map(),
    resolveUserName: async (userId) => `user-${userId}`,
    resolveChatTitle: async (chatId) => `chat-${chatId}`,
    prefetchUserAvatars: () => undefined,
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

  it('carries can_be_saved so the viewer can refuse protected media', async () => {
    const message = await mapMessage(makeContext(), 7, {
      id: 102,
      date: 10,
      can_be_saved: false,
      sender_id: { _: 'messageSenderUser', user_id: 42 },
      content: { _: 'messageText', text: { text: 'protected' } },
    })

    expect(message.canBeSaved).toBe(false)
  })

  it('carries a cached sender photo and queues one that is missing', async () => {
    const prefetchUserAvatars = vi.fn()
    const raw = {
      id: 101,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 42 },
      content: { _: 'messageText', text: { text: 'hi' } },
    }

    const cached = await mapMessage(
      makeContext({ userAvatarUrls: new Map([[42, 'wx-media://f/face']]), prefetchUserAvatars }),
      7,
      raw,
    )
    expect(cached.senderAvatarUrl).toBe('wx-media://f/face')

    const missing = await mapMessage(makeContext({ prefetchUserAvatars }), 7, raw)
    expect(missing).not.toHaveProperty('senderAvatarUrl')
    expect(prefetchUserAvatars).toHaveBeenCalledWith([42])
  })

  it('draws a channel post with the chat photo', async () => {
    const message = await mapMessage(
      makeContext({ chatAvatarUrls: new Map([[55, 'wx-media://f/channel']]) }),
      8,
      {
        id: 2,
        date: 10,
        sender_id: { _: 'messageSenderChat', chat_id: 55 },
        content: { _: 'messageText', text: { text: 'post' } },
      },
    )

    expect(message.senderAvatarUrl).toBe('wx-media://f/channel')
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

  it('carries a channel author signature and drops blank or non-string values', async () => {
    const raw = {
      id: 1,
      date: 10,
      sender_id: { _: 'messageSenderChat', chat_id: 55 },
      content: { _: 'messageText', text: { text: 'post' } },
    }
    const signed = await mapMessage(makeContext(), 8, {
      ...raw,
      author_signature: '  Elvin Starry  ',
    })
    expect(signed.authorSignature).toBe('Elvin Starry')

    for (const authorSignature of ['', '   ', 42]) {
      const unsigned = await mapMessage(makeContext(), 8, {
        ...raw,
        author_signature: authorSignature,
      })
      expect(unsigned).not.toHaveProperty('authorSignature')
    }
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

  it('composes a poll option notice instead of marking it unsupported', async () => {
    const message = await mapMessage(makeContext(), 9, {
      id: 4,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 3 },
      is_outgoing: true,
      content: { _: 'messagePollOptionAdded', text: { text: '4' } },
    })

    expect(message.kind).toBe('service')
    expect(message.text).toBe('你已将“4”添加到投票中')
  })

  it('composes a call notice and an expired-media notice instead of dropping them', async () => {
    const call = await mapMessage(makeContext(), 3, {
      id: 5,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 37 },
      content: {
        _: 'messageCall',
        is_video: true,
        discard_reason: { _: 'callDiscardReasonMissed' },
        duration: 0,
      },
    })
    expect(call.kind).toBe('service')
    expect(call.text).toBe('未接听视频通话')

    const expired = await mapMessage(makeContext(), 3, {
      id: 6,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 37 },
      is_outgoing: true,
      content: { _: 'messageExpiredPhoto' },
    })
    expect(expired.kind).toBe('service')
    expect(expired.text).toBe('你发送的图片已过期')
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

  it('carries a rich message body into the DTO, not just its flattened text', async () => {
    const message = await mapMessage(makeContext(), 9, {
      id: 7,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 3 },
      content: {
        _: 'messageRichMessage',
        message: {
          _: 'richMessage',
          is_full: true,
          is_rtl: false,
          blocks: [{ _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '广告' } }],
        },
      },
    })

    expect(message.kind).toBe('rich')
    expect(message.text).toBe('广告')
    // Dropping `rich` here made every rich message render as its flat text.
    expect(message.rich).toHaveLength(1)
  })

  it('asks for the full version of a truncated rich message', async () => {
    const resolveFullRichMessage = vi.fn(async () => ({
      _: 'richMessage',
      is_full: true,
      is_rtl: false,
      blocks: [{ _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '完整' } }],
    }))
    const message = await mapMessage(makeContext({ resolveFullRichMessage }), 9, {
      id: 8,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 3 },
      content: {
        _: 'messageRichMessage',
        message: { _: 'richMessage', is_full: false, is_rtl: false, blocks: [] },
      },
    })

    expect(resolveFullRichMessage).toHaveBeenCalledWith(9, 8)
    expect(message.text).toBe('完整')
  })
  it('keeps the album id of a media group item and drops TDLib\'s "0"', async () => {
    const inAlbum = await mapMessage(makeContext(), 7, {
      id: 5,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 42 },
      // int64 arrives as a string; the value is over 2^53 on purpose.
      media_album_id: '1234567890123456789',
      content: {
        _: 'messagePhoto',
        photo: { sizes: [{ width: 10, height: 10, photo: { id: 6 } }] },
      },
    })
    expect(inAlbum.albumId).toBe('1234567890123456789')

    const single = await mapMessage(makeContext(), 7, {
      id: 6,
      date: 11,
      sender_id: { _: 'messageSenderUser', user_id: 42 },
      media_album_id: '0',
      content: { _: 'messageText', text: { text: 'hi' } },
    })
    expect(single).not.toHaveProperty('albumId')
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

  it('carries the inline keyboard that hangs off the message', async () => {
    const message = await mapMessage(makeContext(), 9, {
      id: 9,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 3 },
      content: { _: 'messageText', text: { text: 'hi' } },
      reply_markup: {
        _: 'replyMarkupInlineKeyboard',
        force_reply: false,
        rows: [
          [
            {
              _: 'inlineKeyboardButton',
              text: '打开',
              type: { _: 'inlineKeyboardButtonTypeUrl', url: 'https://x.test' },
            },
          ],
        ],
      },
    })

    expect(message.buttons).toEqual([[{ text: '打开', url: 'https://x.test' }]])
  })

  it('marks the two client-side markups a bot can send', async () => {
    // 强制回复: the pane offers the row as the reply target (§8.3).
    const forced = await mapMessage(makeContext(), 9, {
      id: 11,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 26 },
      content: { _: 'messageText', text: { text: '请回答' } },
      reply_markup: { _: 'replyMarkupForceReply', is_personal: true, placeholder: '写下答案' },
    })
    expect(forced.forceReply).toEqual({ placeholder: '写下答案' })

    // 撤键盘: the removal row carries no keyboard of its own, only the marker.
    const removed = await mapMessage(makeContext(), 9, {
      id: 12,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 26 },
      content: { _: 'messageText', text: { text: '键盘收走了' } },
      reply_markup: { _: 'replyMarkupRemoveKeyboard', is_personal: true },
    })
    expect(removed.replyKeyboardHidden).toBe(true)
    expect(removed.replyKeyboard).toBeUndefined()
  })

  it('maps a contact message into a card the renderer can draw', async () => {
    const message = await mapMessage(makeContext(), 9, {
      id: 10,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 3 },
      content: {
        _: 'messageContact',
        contact: {
          phone_number: '+86 132 8826 1857',
          first_name: '假钞',
          last_name: '',
          vcard: '',
          user_id: 4242,
        },
      },
    })

    expect(message.kind).toBe('contact')
    expect(message.text).toBe('假钞')
    expect(message.contact).toEqual({
      firstName: '假钞',
      phone: '+86 132 8826 1857',
      userId: 4242,
    })
  })
  it('maps views, forwards and the comment count into the DTO', async () => {
    const message = await mapMessage(makeContext(), 8, {
      id: 3,
      date: 10,
      sender_id: { _: 'messageSenderChat', chat_id: 55 },
      content: { _: 'messageText', text: { text: 'post' } },
      interaction_info: {
        _: 'messageInteractionInfo',
        view_count: 12_400,
        forward_count: 96,
        reply_info: {
          _: 'messageReplyInfo',
          reply_count: 78,
          recent_replier_ids: [],
          last_read_inbox_message_id: 0,
          last_read_outbox_message_id: 0,
          last_message_id: 0,
        },
      },
    })

    expect(message.interaction).toEqual({
      comments: 78,
      views: 12_400,
      forwards: 96,
      canOpen: true,
    })
  })

  it('keeps a thread that nobody has commented in yet', async () => {
    const quiet = await mapMessage(makeContext(), 2, {
      id: 5,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 42 },
      content: { _: 'messageText', text: { text: 'hi' } },
      interaction_info: {
        _: 'messageInteractionInfo',
        view_count: 0,
        forward_count: 0,
        reply_info: { _: 'messageReplyInfo', reply_count: 0 },
      },
    })
    // reply_info is the "this post owns a comment section" signal, so a thread
    // with 0 comments still draws 写评论 — otherwise nobody can be the first.
    expect(quiet.interaction).toEqual({ comments: 0, canOpen: true })

    const noThread = await mapMessage(makeContext(), 2, {
      id: 6,
      date: 10,
      sender_id: { _: 'messageSenderUser', user_id: 42 },
      content: { _: 'messageText', text: { text: 'hi' } },
      interaction_info: {
        _: 'messageInteractionInfo',
        view_count: 0,
        forward_count: 0,
      },
    })
    expect(noThread).not.toHaveProperty('interaction')
  })
})
describe('mapReactions', () => {
  function raw(interactionInfo: unknown): Record<string, unknown> {
    return { interaction_info: interactionInfo }
  }

  it('reads emoji and custom reactions, newest first as TDLib sends them', () => {
    const reactions = mapReactions(
      raw({
        reactions: {
          reactions: [
            {
              _: 'messageReaction',
              reaction_type: { _: 'reactionTypeEmoji', emoji: '👍' },
              total_count: 3,
              is_chosen: true,
            },
            {
              _: 'messageReaction',
              reaction_type: {
                _: 'reactionTypeCustomEmoji',
                custom_emoji_id: '5909018290759408123',
              },
              total_count: 2,
            },
          ],
        },
      }),
    )

    // The custom id is an int64: carried as a string so the sticker lookup can use it.
    expect(reactions).toEqual([
      { emoji: '👍', count: 3, chosen: true },
      { customEmojiId: '5909018290759408123', count: 2 },
    ])
  })

  it('has nothing to draw without reactions, or with a zero count', () => {
    expect(mapReactions({})).toBeUndefined()
    expect(mapReactions(raw({ reactions: { reactions: [] } }))).toBeUndefined()
    expect(
      mapReactions(
        raw({
          reactions: {
            reactions: [{ reaction_type: { _: 'reactionTypeEmoji', emoji: '👍' }, total_count: 0 }],
          },
        }),
      ),
    ).toBeUndefined()
  })

  it('drops a reaction kind this client cannot draw', () => {
    expect(
      mapReactions(
        raw({
          reactions: { reactions: [{ reaction_type: { _: 'reactionTypePaid' }, total_count: 4 }] },
        }),
      ),
    ).toBeUndefined()
  })
})
