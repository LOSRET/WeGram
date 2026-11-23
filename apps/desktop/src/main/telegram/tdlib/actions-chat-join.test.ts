import { describe, expect, it } from 'vitest'

import { chatJoinState, joinChannel } from './actions'
import type { ActionDeps } from './actions'
import type { TdObject } from './client'
import type { MapperContext } from './map/context'

/**
 * 频道底栏 (design doc §9.9): whether the account subscribes to a channel, and the
 * 加入 / 申请加入 call the bar makes when it does not.
 *
 * Split from `actions.test.ts` when that file reached the size budget; the
 * fake adapter below is the same one, kept here so the halves stay independent.
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

describe('chatJoinState', () => {
  const channel = { _: 'chatTypeSupergroup', is_channel: true, supergroup_id: 9 }

  function joinDeps(type: TdObject, supergroup: TdObject | null): ReturnType<typeof makeDeps> {
    return makeDeps((method) => {
      if (method._ === 'getChat') return { id: 5, type }
      if (method._ === 'getSupergroup') {
        expect(method.supergroup_id).toBe(9)
        return supergroup
      }
      throw new Error(`unexpected ${String(method._)}`)
    })
  }

  it('reports a subscriber as joined', async () => {
    const { deps } = joinDeps(channel, { status: { _: 'chatMemberStatusMember' } })
    await expect(chatJoinState(deps, 5)).resolves.toEqual({ joined: true, byRequest: false })
  })

  it('reports a channel reached from 搜索 as not joined, with its approval rule', async () => {
    const { deps } = joinDeps(channel, {
      status: { _: 'chatMemberStatusLeft' },
      join_by_request: true,
    })
    await expect(chatJoinState(deps, 5)).resolves.toEqual({ joined: false, byRequest: true })
  })

  it('follows is_member for a restricted account', async () => {
    const member = joinDeps(channel, {
      status: { _: 'chatMemberStatusRestricted', is_member: true },
    })
    const outsider = joinDeps(channel, {
      status: { _: 'chatMemberStatusRestricted', is_member: false },
    })
    await expect(chatJoinState(member.deps, 5)).resolves.toMatchObject({ joined: true })
    await expect(chatJoinState(outsider.deps, 5)).resolves.toMatchObject({ joined: false })
  })

  it('reports a banned account as not joined instead of hiding the channel', async () => {
    const { deps } = joinDeps(channel, { status: { _: 'chatMemberStatusBanned' } })
    await expect(chatJoinState(deps, 5)).resolves.toEqual({ joined: false, byRequest: false })
  })

  it('answers "joined" for groups and private chats without asking', async () => {
    const group = joinDeps({ _: 'chatTypeSupergroup', is_channel: false, supergroup_id: 9 }, null)
    const privateChat = joinDeps({ _: 'chatTypePrivate', user_id: 7 }, null)
    await expect(chatJoinState(group.deps, 5)).resolves.toEqual({
      joined: true,
      byRequest: false,
    })
    await expect(chatJoinState(privateChat.deps, 5)).resolves.toEqual({
      joined: true,
      byRequest: false,
    })
    expect(group.calls.map((call) => call._)).toEqual(['getChat'])
    expect(privateChat.calls.map((call) => call._)).toEqual(['getChat'])
  })
})

describe('joinChannel', () => {
  function joinResultDeps(result: TdObject | null): ReturnType<typeof makeDeps> {
    return makeDeps((method) => {
      if (method._ === 'joinChat') return result
      throw new Error(`unexpected ${String(method._)}`)
    })
  }

  it('subscribes at once on a public channel', async () => {
    const { deps, calls } = joinResultDeps({ _: 'chatJoinResultSuccess' })
    await expect(joinChannel(deps, 5)).resolves.toEqual({ joined: true, requestSent: false })
    expect(calls).toEqual([{ _: 'joinChat', chat_id: 5 }])
  })

  it('reports a join request instead of a membership', async () => {
    const { deps } = joinResultDeps({ _: 'chatJoinResultRequestSent' })
    await expect(joinChannel(deps, 5)).resolves.toEqual({ joined: false, requestSent: true })
  })

  it('refuses a bot-guarded channel with a readable error', async () => {
    const { deps } = joinResultDeps({ _: 'chatJoinResultGuardBotApprovalRequired' })
    await expect(joinChannel(deps, 5)).rejects.toMatchObject({
      code: 'not_implemented',
      message: '这个频道需要通过机器人验证才能加入',
    })
  })

  it('turns an unknown answer into an error, never a silent join', async () => {
    const { deps } = joinResultDeps(null)
    await expect(joinChannel(deps, 5)).rejects.toMatchObject({
      code: 'internal',
      message: '加入频道失败',
    })
  })
})
