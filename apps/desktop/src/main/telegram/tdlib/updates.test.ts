import { describe, expect, it, vi } from 'vitest'

import { createUpdateHandler, type UpdateDeps } from './updates'
import type { TdObject } from './client'
import type { MapperContext } from './map/context'

function mapper(): MapperContext {
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

function updateDeps(invoke: UpdateDeps['invoke']): UpdateDeps {
  return {
    invoke,
    emit: vi.fn(),
    mapper: mapper(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    setAuth: vi.fn(),
    setBoot: vi.fn(),
    setConnection: vi.fn(),
    setConnectionBoot: vi.fn(),
    me: async () => ({ id: 1, firstName: 'me' }),
    fetchChatSummary: async (chatId) => ({
      id: chatId,
      title: 'chat',
      kind: 'private',
      unread: 0,
      pinned: false,
      muted: false,
    }),
    avatars: {
      prefetch: vi.fn(),
      syncUserPhoto: vi.fn(),
      invalidate: vi.fn(),
      loadSelf: vi.fn(),
    },
    getSelfUserId: () => 1,
    safeVersion: () => 'test',
  }
}

function pollContent(total: number): TdObject {
  return {
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
  }
}

describe('poll content updates', () => {
  it('applies updateMessageContent.new_content without a second getMessage read', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('poll updates must not re-read the message')
    })
    const deps = updateDeps(invoke)

    await createUpdateHandler(deps)({
      _: 'updateMessageContent',
      chat_id: 500,
      message_id: 42,
      new_content: pollContent(18),
    })

    expect(invoke).not.toHaveBeenCalled()
    expect(deps.emit).toHaveBeenCalledWith({
      type: 'messages',
      chatId: 500,
      ops: [
        {
          op: 'poll',
          chatId: 500,
          messageId: 42,
          poll: expect.objectContaining({ id: '55', totalVoterCount: 18 }),
        },
      ],
    })
  })

  it('still remaps non-poll content changes', async () => {
    const invoke = vi.fn(async (method: TdObject) => {
      expect(method).toEqual({ _: 'getMessage', chat_id: 500, message_id: 42 })
      return {
        id: 42,
        date: 1,
        sender_id: { _: 'messageSenderUser', user_id: 7 },
        content: { _: 'messageText', text: { text: 'changed' } },
      }
    })
    const deps = updateDeps(invoke)

    await createUpdateHandler(deps)({
      _: 'updateMessageContent',
      chat_id: 500,
      message_id: 42,
      new_content: { _: 'messageText', text: { text: 'changed' } },
    })

    expect(invoke).toHaveBeenCalledOnce()
    expect(deps.emit).toHaveBeenCalledWith({
      type: 'messages',
      chatId: 500,
      ops: [{ op: 'replace', message: expect.objectContaining({ id: 42, text: 'changed' }) }],
    })
  })
})
