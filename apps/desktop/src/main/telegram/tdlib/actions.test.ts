import { describe, expect, it, vi } from 'vitest'

import {
  beginStream,
  canGetMembers,
  canPost,
  history,
  historyAround,
  historyNewer,
  openChat,
  openUsernameChat,
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

describe('openUsernameChat', () => {
  const ada: TdObject = {
    id: 7,
    title: 'Ada Lovelace',
    type: { _: 'chatTypePrivate', user_id: 21 },
    unread_count: 0,
    last_read_outbox_message_id: 0,
  }

  it('resolves an @username mention to its chat and pushes the row', async () => {
    const { deps, calls, events } = makeDeps((method) =>
      method._ === 'searchPublicChat' ? ada : null,
    )

    const chat = await openUsernameChat(deps, ' @ada_lovelace ')

    // The mention covers the @; TDLib wants the bare name.
    expect(calls).toEqual([{ _: 'searchPublicChat', username: 'ada_lovelace' }])
    expect(chat).toMatchObject({ id: 7, title: 'Ada Lovelace', kind: 'private', userId: 21 })
    // Upserted like `openPrivateChat`, so the row exists before the pane mounts.
    expect(events).toEqual([{ type: 'chats', ops: [{ op: 'upsert', chat }] }])
  })

  it('reports a name nobody owns as a payload error, not a broken pane', async () => {
    const { deps } = makeDeps((method) => {
      if (method._ === 'searchPublicChat') {
        throw Object.assign(new Error('USERNAME_NOT_OCCUPIED'), { code: 400 })
      }
      return null
    })

    await expect(openUsernameChat(deps, '@nobody')).rejects.toMatchObject({
      code: 'invalid_payload',
      message: '找不到 @nobody 这个用户名',
    })
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

describe('canGetMembers', () => {
  const channel = { _: 'chatTypeSupergroup', is_channel: true, supergroup_id: 9 }

  function memberDeps(type: TdObject, info: TdObject | null | Error): ReturnType<typeof makeDeps> {
    return makeDeps((method) => {
      if (method._ === 'getChat') return { id: 5, type }
      if (method._ === 'getSupergroupFullInfo') {
        if (info instanceof Error) throw info
        return info
      }
      throw new Error(`unexpected ${String(method._)}`)
    })
  }

  it("lets an administrator read a channel's members", async () => {
    const { deps, calls } = memberDeps(channel, { can_get_members: true })
    await expect(canGetMembers(deps, 5)).resolves.toBe(true)
    expect(calls.find((call) => call._ === 'getSupergroupFullInfo')).toMatchObject({
      supergroup_id: 9,
    })
  })

  it('keeps the grid closed for a subscriber', async () => {
    const { deps } = memberDeps(channel, { can_get_members: false })
    await expect(canGetMembers(deps, 5)).resolves.toBe(false)
  })

  it('never asks for a basic group or a private chat, and answers for both', async () => {
    const basic = memberDeps({ _: 'chatTypeBasicGroup', basic_group_id: 3 }, null)
    await expect(canGetMembers(basic.deps, 5)).resolves.toBe(true)
    expect(basic.calls.map((call) => call._)).toEqual(['getChat'])

    const privateChat = memberDeps({ _: 'chatTypePrivate', user_id: 7 }, null)
    await expect(canGetMembers(privateChat.deps, 5)).resolves.toBe(false)
    expect(privateChat.calls.map((call) => call._)).toEqual(['getChat'])
  })

  it('answers false when the full info cannot be read', async () => {
    const { deps } = memberDeps(channel, new Error('not cached'))
    await expect(canGetMembers(deps, 5)).resolves.toBe(false)
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
describe('beginStream', () => {
  /**
   * A cold clip answers its `downloadFile` call with the state it had *before*
   * the transfer was queued: `local.path` empty, which used to be read as "this
   * file cannot be streamed" on the very first click. TDLib reports the path
   * with the next update, so the call has to wait for it.
   */
  it("waits for the update that finally carries a cold file's local path", async () => {
    vi.useFakeTimers()
    try {
      const { deps, calls } = makeDeps((method) => {
        if (method._ === 'downloadFile') return { expected_size: 900, local: { path: '' } }
        if (method._ === 'getFile')
          return { expected_size: 900, local: { path: 'C:/cache/6000.mp4' } }
        throw new Error(`unexpected ${String(method._)}`)
      })

      const pending = beginStream(deps, { fileId: 6000, offset: 0, priority: 28 })
      await vi.advanceTimersByTimeAsync(100)

      await expect(pending).resolves.toEqual({ path: 'C:/cache/6000.mp4', size: 900 })
      expect(calls.map((call) => call._)).toEqual(['downloadFile', 'getFile'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up when TDLib never reports a usable file', async () => {
    vi.useFakeTimers()
    try {
      const { deps } = makeDeps(() => ({ expected_size: 0, local: { path: '' } }))

      const pending = beginStream(deps, { fileId: 6000, offset: 0, priority: 28 })
      const rejected = expect(pending).rejects.toMatchObject({
        code: 'internal',
        message: 'File 6000 cannot be streamed yet',
      })
      await vi.advanceTimersByTimeAsync(5_000)

      await rejected
    } finally {
      vi.useRealTimers()
    }
  })
})