import { describe, expect, it, vi } from 'vitest'

import { refreshPoll, votePoll } from './actions/poll'
import type { ActionDeps } from './actions/deps'
import type { TdObject } from './client'
import type { MapperContext } from './map/context'

function context(): MapperContext {
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

function pollMessage(total: number): TdObject {
  return {
    id: 42,
    date: 1_700_000_000,
    is_outgoing: false,
    sender_id: { _: 'messageSenderUser', user_id: 7 },
    content: {
      _: 'messagePoll',
      poll: {
        id: '55',
        question: { text: 'pick' },
        options: [
          { text: { text: 'a' }, voter_count: total, vote_percentage: 100 },
          { text: { text: 'b' }, voter_count: 0, vote_percentage: 0 },
        ],
        total_voter_count: total,
        is_anonymous: true,
        type: { _: 'pollTypeRegular' },
        can_see_results: true,
      },
    },
  }
}

function deps(invoke: ActionDeps['invoke']): ActionDeps {
  return {
    invoke,
    mapper: context(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    emit: vi.fn(),
    prefetchChatAvatars: () => undefined,
  }
}

describe('refreshPoll', () => {
  it('touches the message without emitting a stale heartbeat replacement', async () => {
    const invoke = vi.fn(async (method: TdObject) => {
      expect(method).toEqual({ _: 'getMessage', chat_id: 500, message_id: 42 })
      return pollMessage(18)
    })
    const actionDeps = deps(invoke)

    await expect(refreshPoll(actionDeps, { chatId: 500, messageId: 42 })).resolves.toBe(true)
    expect(actionDeps.emit).not.toHaveBeenCalled()
  })

  it('still announces the server copy after this account votes', async () => {
    const invoke = vi.fn(async (method: TdObject) => {
      if (method._ === 'setPollAnswer') return { _: 'ok' }
      expect(method).toEqual({ _: 'getMessage', chat_id: 500, message_id: 42 })
      return pollMessage(1)
    })
    const actionDeps = deps(invoke)

    await expect(
      votePoll(actionDeps, { chatId: 500, messageId: 42, optionIds: [0] }),
    ).resolves.toBeUndefined()
    expect(actionDeps.emit).toHaveBeenCalledWith({
      type: 'messages',
      chatId: 500,
      ops: [
        {
          op: 'replace',
          message: expect.objectContaining({
            id: 42,
            poll: expect.objectContaining({ totalVoterCount: 1 }),
          }),
        },
      ],
    })
  })

  it('reports a vanished poll as false instead of raising the error banner', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('Message not found')
    })
    const actionDeps = deps(invoke)

    await expect(refreshPoll(actionDeps, { chatId: 500, messageId: 42 })).resolves.toBe(false)
    expect(actionDeps.emit).not.toHaveBeenCalled()
    expect(actionDeps.logger.warn).toHaveBeenCalledOnce()
  })

  it('does not replace a message whose content is no longer a poll', async () => {
    const actionDeps = deps(async () => ({
      id: 42,
      date: 1,
      content: { _: 'messageText', text: { text: 'edited' } },
    }))

    await expect(refreshPoll(actionDeps, { chatId: 500, messageId: 42 })).resolves.toBe(false)
    expect(actionDeps.emit).not.toHaveBeenCalled()
  })
})
