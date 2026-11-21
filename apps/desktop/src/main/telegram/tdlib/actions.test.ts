import { describe, expect, it } from 'vitest'

import {
  canPost,
  commentInfo,
  history,
  historyAround,
  historyNewer,
  joinCommentGroup,
  openChat,
  sendComment,
  setChatMuted,
} from './actions'
import type { ActionDeps, PostPermissionDeps } from './actions'
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

describe('historyAround', () => {
  it('merges older rows, the anchor and newer rows into one contiguous window', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getChat') return { id: 1, last_message: { id: 1005, date: 1 } }
      if (method._ === 'getMessage') return rawMessage(1000, 'anchor')
      if (method._ === 'getChatHistory') {
        return method.offset === 0
          ? { messages: [rawMessage(999, 'older'), rawMessage(998, 'oldest')] }
          : { messages: [rawMessage(1002, 'newer'), rawMessage(1001, 'newer-1')] }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const page = await historyAround(deps, { chatId: 1, messageId: 1000, limit: 2 })

    expect(page.messages.map((message) => message.id)).toEqual([998, 999, 1000, 1001, 1002])
    expect(page.hasNewer).toBe(true)
    // The newer half must use a negative offset; offset 0 means "older than".
    expect(calls.find((call) => call._ === 'getChatHistory' && call.offset === -2)).toMatchObject({
      from_message_id: 1000,
      limit: 2,
    })
  })

  it('reports hasNewer=false when the window reaches the newest message', async () => {
    const { deps } = makeDeps((method) => {
      if (method._ === 'getChat') return { id: 1, last_message: { id: 1002, date: 1 } }
      if (method._ === 'getMessage') return rawMessage(1000, 'anchor')
      if (method._ === 'getChatHistory') {
        return method.offset === 0
          ? { messages: [rawMessage(999, 'older')] }
          : { messages: [rawMessage(1002, 'newest'), rawMessage(1001, 'newer')] }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const page = await historyAround(deps, { chatId: 1, messageId: 1000, limit: 2 })
    expect(page.hasNewer).toBe(false)
  })
})

describe('historyNewer', () => {
  it('asks for messages newer than the window tail and keeps only those', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getChat') return { id: 1, last_message: { id: 1005, date: 1 } }
      if (method._ === 'getChatHistory') {
        return { messages: [rawMessage(1004, 'n2'), rawMessage(1003, 'n1')] }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const page = await historyNewer(deps, { chatId: 1, fromMessageId: 1002, limit: 2 })

    expect(page.messages.map((message) => message.id)).toEqual([1003, 1004])
    expect(page.hasNewer).toBe(true)
    expect(calls.find((call) => call._ === 'getChatHistory')).toMatchObject({
      from_message_id: 1002,
      offset: -2,
    })
  })
})

describe('canPost', () => {
  function permissionDeps(
    type: TdObject,
    status: TdObject | null,
    selfUserId: number | null = 7,
  ): { deps: PostPermissionDeps; calls: TdObject[] } {
    const calls: TdObject[] = []
    return {
      calls,
      deps: {
        invoke: async (method) => {
          calls.push(method)
          if (method._ === 'getChat') return { id: 5, type }
          if (method._ === 'getChatMember') return { status }
          throw new Error(`unexpected ${String(method._)}`)
        },
        getSelfUserId: () => selfUserId,
      },
    }
  }

  const channel = { _: 'chatTypeSupergroup', is_channel: true }

  it('lets the channel creator post', async () => {
    const { deps } = permissionDeps(channel, { _: 'chatMemberStatusCreator' })
    await expect(canPost(deps, 5)).resolves.toBe(true)
  })

  it('follows can_post_messages for an administrator', async () => {
    const allowed = permissionDeps(channel, {
      _: 'chatMemberStatusAdministrator',
      rights: { can_post_messages: true },
    })
    const denied = permissionDeps(channel, {
      _: 'chatMemberStatusAdministrator',
      rights: { can_post_messages: false },
    })

    await expect(canPost(allowed.deps, 5)).resolves.toBe(true)
    await expect(canPost(denied.deps, 5)).resolves.toBe(false)
  })

  it('keeps a plain subscriber channel read-only', async () => {
    const { deps } = permissionDeps(channel, { _: 'chatMemberStatusMember' })
    await expect(canPost(deps, 5)).resolves.toBe(false)
  })

  it('does not gate groups and private chats', async () => {
    const { deps, calls } = permissionDeps({ _: 'chatTypeSupergroup', is_channel: false }, null)
    await expect(canPost(deps, 5)).resolves.toBe(true)
    // Only the chat itself is read: no member lookup for a composer that is always there.
    expect(calls.map((call) => call._)).toEqual(['getChat'])
  })

  it('answers false before the account id is known', async () => {
    const { deps, calls } = permissionDeps(channel, null, null)
    await expect(canPost(deps, 5)).resolves.toBe(false)
    expect(calls).toEqual([])
  })
})

describe('setChatMuted', () => {
  it('changes only the mute fields and answers the refreshed chat', async () => {
    const settings = {
      _: 'chatNotificationSettings',
      use_default_mute_for: true,
      mute_for: 0,
      use_default_sound: false,
      sound_id: '42',
      use_default_show_preview: false,
      show_preview: false,
      use_default_disable_pinned_message_notifications: true,
      disable_pinned_message_notifications: false,
      use_default_disable_mention_notifications: true,
      disable_mention_notifications: false,
    }
    // TDLib answers the next `getChat` with the settings it was given, so the
    // fake has to store them too or the refreshed summary cannot show the mute.
    const stored: Record<string, unknown> = { ...settings }
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getChat') {
        return {
          id: 5,
          title: 'Channel',
          type: { _: 'chatTypeSupergroup', is_channel: true },
          notification_settings: stored,
          unread_count: 0,
        }
      }
      if (method._ === 'setChatNotificationSettings') {
        Object.assign(stored, method.notification_settings)
        return { _: 'ok' }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const chat = await setChatMuted(deps, 5, true)

    expect(chat.muted).toBe(true)
    const call = calls.find((item) => item._ === 'setChatNotificationSettings')
    expect(call?.notification_settings).toMatchObject({
      use_default_mute_for: false,
      mute_for: 2_147_483_647,
      // Everything else is carried over: toggling mute must not reset sounds or previews.
      sound_id: '42',
      show_preview: false,
      use_default_sound: false,
    })
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
describe('sendComment', () => {
  it('posts into the discussion group, replying to the thread root', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getMessageThread') return { chat_id: -100123, message_thread_id: 77 }
      if (method._ === 'sendMessage') return rawMessage(500, 'comment')
      throw new Error(`unexpected ${String(method._)}`)
    })

    const sent = await sendComment(deps, { chatId: -100999, messageId: 12, text: '同问' })

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

    await sendComment(deps, { chatId: -100999, messageId: 12, text: '回复你', replyTo: 500 })

    const send = calls.find((call) => call._ === 'sendMessage')
    expect(send?.reply_to).toEqual({ _: 'inputMessageReplyToMessage', message_id: 500 })
  })

  it('refuses a message that has no discussion thread', async () => {
    const { deps, calls } = makeDeps(() => ({ chat_id: 0, message_thread_id: 0 }))
    await expect(sendComment(deps, { chatId: 1, messageId: 2, text: 'x' })).rejects.toThrow(
      /讨论群组/,
    )
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
