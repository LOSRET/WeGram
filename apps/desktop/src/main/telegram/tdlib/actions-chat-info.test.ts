import { describe, expect, it } from 'vitest'

import {
  clearHistory,
  inviteLink,
  leaveChat,
  listMembers,
  pinnedMessage,
  setChatPinned,
  setChatTitle,
} from './actions'
import type { ActionDeps, InviteLinkDeps } from './actions'
import type { TdObject } from './client'
import type { MapperContext } from './map/context'

/**
 * The 聊天信息 panel's write paths (design doc §9.9): the mute/pin pair, 清空聊天
 * 记录, 退出群聊, 群聊名称, 群公告 and 群二维码, plus the member grid and its
 * 搜索群成员 query.
 *
 * Split from `actions.test.ts` when that file reached the 550-line budget; the
 * fake adapter below is the same one, kept here so the two halves stay independent.
 */

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

describe('setChatPinned', () => {
  it('pins in the main list and answers the refreshed chat', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'toggleChatIsPinned') return { _: 'ok' }
      if (method._ === 'getChat') {
        return {
          id: 5,
          title: 'Group',
          type: { _: 'chatTypeSupergroup', is_channel: false },
          positions: [
            {
              _: 'chatPosition',
              list: { _: 'chatListMain' },
              order: '1',
              is_pinned: true,
            },
          ],
        }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const chat = await setChatPinned(deps, 5, true)

    expect(chat.pinned).toBe(true)
    expect(calls.find((call) => call._ === 'toggleChatIsPinned')).toMatchObject({
      chat_id: 5,
      is_pinned: true,
      // The flag lives on the chat's position in a list, so the call must name one.
      chat_list: { _: 'chatListMain' },
    })
  })
})

describe('clearHistory', () => {
  it("clears this account's copy and refreshes the chat row", async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'deleteChatHistory') return { _: 'ok' }
      if (method._ === 'getChat') {
        return { id: 5, title: 'Group', type: { _: 'chatTypeSupergroup', is_channel: false } }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await clearHistory(deps, 5)

    expect(calls.find((call) => call._ === 'deleteChatHistory')).toMatchObject({
      chat_id: 5,
      remove_from_chat_list: false,
      // WeChat's 清空聊天记录 deletes for me, not for the other members.
      revoke: false,
    })
    expect(calls.some((call) => call._ === 'getChat')).toBe(true)
  })
})

describe('listMembers', () => {
  it('maps the user members, skipping chat senders', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getChat') {
        return { id: -1001, type: { _: 'chatTypeSupergroup', is_channel: false } }
      }
      if (method._ === 'searchChatMembers') {
        return {
          members: [
            { member_id: { _: 'messageSenderUser', user_id: 7 } },
            { member_id: { _: 'messageSenderChat', chat_id: 9 } },
            { member_id: { _: 'messageSenderUser', user_id: 8 } },
          ],
        }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const members = await listMembers(deps, -1001, 12)

    expect(members).toEqual([
      { userId: 7, title: 'user-7' },
      { userId: 8, title: 'user-8' },
    ])
    expect(calls.find((call) => call._ === 'searchChatMembers')).toMatchObject({
      chat_id: -1001,
      query: '',
      limit: 12,
    })
  })

  it('has no member table for a private chat', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getChat') return { id: 5, type: { _: 'chatTypePrivate', user_id: 7 } }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await expect(listMembers(deps, 5, 12)).resolves.toEqual([])
    expect(calls.some((call) => call._ === 'searchChatMembers')).toBe(false)
  })

  it('answers an empty grid when a channel refuses the list', async () => {
    const { deps } = makeDeps((method) => {
      if (method._ === 'getChat') {
        return { id: -1002, type: { _: 'chatTypeSupergroup', is_channel: true } }
      }
      throw new Error('CHAT_MEMBER_LIST is not accessible')
    })

    await expect(listMembers(deps, -1002, 12)).resolves.toEqual([])
  })

  it('searches the whole member table, not the loaded page', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'getChat') {
        return { id: -1001, type: { _: 'chatTypeSupergroup', is_channel: false } }
      }
      if (method._ === 'searchChatMembers') {
        return { members: [{ member_id: { _: 'messageSenderUser', user_id: 7 } }] }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await listMembers(deps, -1001, 12, 'ada')

    expect(calls.find((call) => call._ === 'searchChatMembers')).toMatchObject({
      query: 'ada',
    })
  })
})

describe('setChatTitle', () => {
  it('renames and answers the refreshed chat', async () => {
    const stored = { title: 'Old' }
    const { deps, calls, events } = makeDeps((method) => {
      if (method._ === 'setChatTitle') {
        stored.title = String(method.title)
        return { _: 'ok' }
      }
      if (method._ === 'getChat') {
        return { id: 5, title: stored.title, type: { _: 'chatTypeSupergroup', is_channel: false } }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const chat = await setChatTitle(deps, 5, 'New')

    expect(chat.title).toBe('New')
    expect(calls.find((call) => call._ === 'setChatTitle')).toMatchObject({
      chat_id: 5,
      title: 'New',
    })
    // Every chat write is announced, so the list row and the panel follow it.
    expect(events).toHaveLength(1)
  })
})

describe('leaveChat', () => {
  it('leaves and announces the removal', async () => {
    const { deps, calls, events } = makeDeps((method) => {
      if (method._ === 'leaveChat') return { _: 'ok' }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await leaveChat(deps, 5)

    expect(calls.find((call) => call._ === 'leaveChat')).toMatchObject({ chat_id: 5 })
    expect(events).toEqual([{ type: 'chats', ops: [{ op: 'remove', chatId: 5 }] }])
  })
})

describe('pinnedMessage', () => {
  it('answers the newest pinned message as a preview', async () => {
    const { deps } = makeDeps((method) => {
      if (method._ === 'getChatPinnedMessage') {
        return {
          id: 900,
          content: { _: 'messageText', text: { _: 'formattedText', text: '开会' } },
        }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await expect(pinnedMessage(deps, 5)).resolves.toEqual({ messageId: 900, text: '开会' })
  })

  it('treats "nothing pinned" as no announcement, not a failure', async () => {
    const { deps } = makeDeps(() => {
      throw new Error('404: Message not found')
    })

    await expect(pinnedMessage(deps, 5)).resolves.toBeNull()
  })
})

describe('inviteLink', () => {
  function inviteDeps(respond: Responder): InviteLinkDeps {
    const { deps } = makeDeps(respond)
    return { ...deps, getSelfUserId: () => 7 }
  }

  it('prefers the public username: it costs no request for a new link', async () => {
    const deps = inviteDeps((method) => {
      if (method._ === 'getChat') {
        return {
          id: -1001,
          type: { _: 'chatTypeSupergroup', supergroup_id: 55, is_channel: false },
        }
      }
      if (method._ === 'getSupergroup') {
        return { usernames: { _: 'usernames', active_usernames: ['wegram'] } }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await expect(inviteLink(deps, -1001)).resolves.toEqual({ link: 'https://t.me/wegram' })
  })

  it("reuses the account's own link before creating a new one", async () => {
    const deps = inviteDeps((method) => {
      if (method._ === 'getChat') {
        return {
          id: -1001,
          type: { _: 'chatTypeSupergroup', supergroup_id: 55, is_channel: false },
        }
      }
      if (method._ === 'getSupergroup') return { usernames: { active_usernames: [] } }
      if (method._ === 'getChatInviteLinks') {
        return { invite_links: [{ invite_link: 'https://t.me/+existing' }] }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await expect(inviteLink(deps, -1001)).resolves.toEqual({ link: 'https://t.me/+existing' })
  })

  it('creates the 7-day code the QR window asks for and dates it', async () => {
    let requested: TdObject | undefined
    const deps = inviteDeps((method) => {
      if (method._ === 'getChat') {
        return {
          id: -1001,
          type: { _: 'chatTypeSupergroup', supergroup_id: 55, is_channel: false },
        }
      }
      if (method._ === 'getSupergroup') return { usernames: { active_usernames: [] } }
      if (method._ === 'createChatInviteLink') {
        requested = method
        return { invite_link: 'https://t.me/+temporary' }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    const answer = await inviteLink(deps, -1001, true)

    expect(answer?.link).toBe('https://t.me/+temporary')
    const now = Math.floor(Date.now() / 1000)
    // Seven days out, within a minute of "now": the window promises 7 天内.
    expect(answer?.expiresAt).toBeGreaterThanOrEqual(now + 7 * 86_400 - 60)
    expect(answer?.expiresAt).toBeLessThanOrEqual(now + 7 * 86_400 + 60)
    expect(Number(requested?.expiration_date)).toBe(answer?.expiresAt)
  })

  it('answers null when the account may neither see nor create a link', async () => {
    const deps = inviteDeps((method) => {
      if (method._ === 'getChat') {
        return { id: -1001, type: { _: 'chatTypeBasicGroup', basic_group_id: 9 } }
      }
      throw new Error('CHAT_ADMIN_REQUIRED')
    })

    await expect(inviteLink(deps, -1001)).resolves.toBeNull()
  })
})
