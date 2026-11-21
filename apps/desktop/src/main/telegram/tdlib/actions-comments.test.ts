import { describe, expect, it } from 'vitest'

import { commentInfo, joinCommentGroup, sendComment } from './actions'
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

function makeDeps(respond: Responder): {
  deps: ActionDeps
  calls: TdObject[]
  events: unknown[]
} {
  const calls: TdObject[] = []
  const events: unknown[] = []
  const deps: ActionDeps = {
    invoke: async (method) => {
      calls.push(method)
      return respond(method)
    },
    mapper: makeContext(),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    emit: (event) => events.push(event),
    prefetchChatAvatars: () => undefined,
  }
  return { deps, calls, events }
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

/**
 * The comment-thread actions (design doc §9.8). Split out of `actions.test.ts`
 * when that file hit its line budget; the comment set has grown a payload per
 * composer tool (text, sticker, media), so it gets its own file and its own
 * small `makeDeps`, like the other `actions-*.test.ts` modules.
 */
describe('sendComment', () => {
  it('posts into the discussion group, replying to the thread root', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getMessageThread') return { chat_id: -100123, message_thread_id: 77 }
      if (method._ === 'sendMessage') return rawMessage(500, 'comment')
      throw new Error(`unexpected ${String(method._)}`)
    })

    const sent = await sendComment(deps, {
      chatId: -100999,
      messageId: 12,
      content: { kind: 'text', text: '同问' },
    })

    // The thread lives in the linked supergroup, not in the channel that was clicked.
    expect(sent.message.chatId).toBe(-100123)
    expect(sent.message.text).toBe('comment')
    const send = calls.find((call) => call._ === 'sendMessage')
    expect(send?.chat_id).toBe(-100123)
    expect(send?.reply_to).toEqual({ _: 'inputMessageReplyToMessage', message_id: 77 })
    expect(send?.input_message_content?.text?.text).toBe('同问')
  })

  it('answers another comment when one is being replied to', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getMessageThread') return { chat_id: -100123, message_thread_id: 77 }
      return rawMessage(501, 'reply')
    })

    await sendComment(deps, {
      chatId: -100999,
      messageId: 12,
      content: { kind: 'text', text: '回复你' },
      replyTo: 500,
    })

    const send = calls.find((call) => call._ === 'sendMessage')
    expect(send?.reply_to).toEqual({ _: 'inputMessageReplyToMessage', message_id: 500 })
  })

  it('posts a sticker from the picker into the same thread', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getMessageThread') return { chat_id: -100123, message_thread_id: 77 }
      return rawMessage(502, '')
    })
    deps.mapper.stickerSizes.set(7003, { width: 128, height: 128 })

    await sendComment(deps, {
      chatId: -100999,
      messageId: 12,
      content: { kind: 'sticker', fileId: 7003 },
    })

    const send = calls.find((call) => call._ === 'sendMessage')
    expect(send?.chat_id).toBe(-100123)
    expect(send?.reply_to).toEqual({ _: 'inputMessageReplyToMessage', message_id: 77 })
    // The size the picker learned when the set was mapped, not a guessed 512.
    expect(send?.input_message_content).toMatchObject({
      _: 'inputMessageSticker',
      sticker: { _: 'inputSticker', width: 128, height: 128 },
    })
    // A media/sticker send carries TDLib's `options` field, as a chat's does.
    expect(send?.options).toBeNull()
  })

  it('posts a local document into the thread', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getMessageThread') return { chat_id: -100123, message_thread_id: 77 }
      return rawMessage(503, '')
    })

    await sendComment(deps, {
      chatId: -100999,
      messageId: 12,
      content: { kind: 'media', filePath: 'C:\\tmp\\spec.md', mediaKind: 'file' },
    })

    const send = calls.find((call) => call._ === 'sendMessage')
    expect(send?.chat_id).toBe(-100123)
    expect(send?.input_message_content).toMatchObject({
      _: 'inputMessageDocument',
      document: { _: 'inputDocument' },
    })
  })

  it('refuses a message that has no discussion thread', async () => {
    const { deps, calls } = makeDeps(() => ({ chat_id: 0, message_thread_id: 0 }))
    await expect(
      sendComment(deps, { chatId: 1, messageId: 2, content: { kind: 'text', text: 'x' } }),
    ).rejects.toThrow(/讨论群组/)
    expect(calls.some((call) => call._ === 'sendMessage')).toBe(false)
  })
})
describe('commentInfo', () => {
  const respond =
    (supergroup: TdObject) =>
    (method: TdObject): TdObject => {
      if (method._ === 'getMessageThread') return { chat_id: -100123, message_thread_id: 77 }
      if (method._ === 'getChat') {
        return {
          type: { _: 'chatTypeSupergroup', supergroup_id: 55, is_channel: false },
          permissions: { _: 'chatPermissions', can_send_basic_messages: true },
        }
      }
      if (method._ === 'getSupergroup') return supergroup
      throw new Error(`unexpected ${String(method._)}`)
    }

  it('lets a non-member post in a public discussion group that does not require joining', async () => {
    const { deps } = makeDeps(
      respond({
        _: 'supergroup',
        status: { _: 'chatMemberStatusLeft' },
        usernames: { _: 'usernames', active_usernames: ['public'], editable_username: 'public' },
        join_to_send_messages: false,
        join_by_request: false,
        is_broadcast_group: false,
        is_slow_mode_enabled: false,
      }),
    )

    const access = await commentInfo(deps, { chatId: -100999, messageId: 12 })

    expect(access).toMatchObject({ canComment: true, joined: false, canJoin: true })
  })

  it('offers a join request when the group requires joining and approval', async () => {
    const { deps } = makeDeps(
      respond({
        _: 'supergroup',
        status: { _: 'chatMemberStatusLeft' },
        usernames: { _: 'usernames', active_usernames: ['private'] },
        join_to_send_messages: true,
        join_by_request: true,
        is_broadcast_group: false,
        is_slow_mode_enabled: false,
      }),
    )

    const access = await commentInfo(deps, { chatId: -100999, messageId: 12 })

    expect(access).toMatchObject({
      canComment: false,
      canJoin: true,
      joinByRequest: true,
    })
  })

  it('reads the slow-mode countdown when it is enabled', async () => {
    const { deps } = makeDeps((method) => {
      if (method._ === 'getMessageThread') return { chat_id: -100123, message_thread_id: 77 }
      if (method._ === 'getChat') {
        return {
          type: { _: 'chatTypeSupergroup', supergroup_id: 55, is_channel: false },
          permissions: { _: 'chatPermissions', can_send_basic_messages: true },
        }
      }
      if (method._ === 'getSupergroup') {
        return {
          _: 'supergroup',
          status: { _: 'chatMemberStatusMember' },
          usernames: { _: 'usernames', active_usernames: [], editable_username: '' },
          join_to_send_messages: true,
          join_by_request: false,
          is_broadcast_group: false,
          is_slow_mode_enabled: true,
        }
      }
      if (method._ === 'getSupergroupFullInfo') return { slow_mode_delay_expires_in: 30 }
      throw new Error(`unexpected ${String(method._)}`)
    })

    expect((await commentInfo(deps, { chatId: -100999, messageId: 12 })).slowModeSeconds).toBe(30)
  })
})

describe('joinCommentGroup', () => {
  it('reports a join request instead of a membership', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getMessageThread') return { chat_id: -100123, message_thread_id: 77 }
      if (method._ === 'joinChat') return { _: 'chatJoinResultRequestSent' }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const result = await joinCommentGroup(deps, { chatId: -100999, messageId: 12 })

    expect(result).toEqual({ joined: false, requestSent: true })
    expect(calls.find((call) => call._ === 'joinChat')?.chat_id).toBe(-100123)
  })
})
