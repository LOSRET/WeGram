import { describe, expect, it } from 'vitest'

import { reportMessage, setUserContact, userCommonChats } from './actions'
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

/** A group chat as TDLib hands it over; only the fields the mapper reads. */
function groupChat(chatId: number): TdObject {
  return {
    id: chatId,
    title: `群 ${chatId}`,
    type: { _: 'chatTypeSupergroup', supergroup_id: chatId, is_channel: false },
    unread_count: 0,
    last_read_outbox_message_id: 0,
  }
}

function makeDeps(respond: (method: TdObject) => TdObject | null): {
  deps: ActionDeps
  calls: TdObject[]
  prefetched: number[][]
} {
  const calls: TdObject[] = []
  const prefetched: number[][] = []
  const deps: ActionDeps = {
    invoke: async (method) => {
      calls.push(method)
      return respond(method)
    },
    mapper: makeContext(),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    emit: () => undefined,
    prefetchChatAvatars: (chatIds) => {
      prefetched.push(chatIds)
    },
  }
  return { deps, calls, prefetched }
}

describe('userCommonChats (共同群聊)', () => {
  it('maps the ids into chat rows and queues their photos', async () => {
    const { deps, prefetched } = makeDeps((method) => {
      if (method._ === 'getGroupsInCommon') {
        return { _: 'chats', chat_ids: [2, 4], total_count: 2 }
      }
      if (method._ === 'getChat') return groupChat(Number(method.chat_id))
      return null
    })

    const chats = await userCommonChats(deps, { userId: 37, offset: 0, limit: 20 })

    expect(chats.map((chat) => chat.id)).toEqual([2, 4])
    expect(chats[0]).toMatchObject({ kind: 'group', title: '群 2' })
    // The card must not wait for the photos: they are queued, like a chat-list page.
    expect(prefetched).toEqual([[2, 4]])
  })

  it("starts at TDLib's first page when no offset is given", async () => {
    const { deps, calls } = makeDeps((method) =>
      method._ === 'getGroupsInCommon' ? { _: 'chats', chat_ids: [], total_count: 0 } : null,
    )

    await userCommonChats(deps, { userId: 37 })

    expect(calls[0]).toEqual({
      _: 'getGroupsInCommon',
      user_id: 37,
      // 0 is "from the top", not a chat id.
      offset_chat_id: 0,
      limit: 50,
    })
  })
})

describe('reportMessage (举报 one message)', () => {
  it('files it against the chat with the message id attached', async () => {
    const { deps, calls } = makeDeps((method) =>
      method._ === 'reportChat'
        ? {
            _: 'reportChatResultOptionRequired',
            title: '举报这条消息',
            options: [{ _: 'reportOption', id: 'c3BhbQ==', text: '垃圾信息' }],
          }
        : null,
    )

    const answer = await reportMessage(deps, { chatId: -1001, messageId: 42 })

    // The ids are what make it a per-message report instead of a chat one.
    expect(calls[0]).toEqual({
      _: 'reportChat',
      chat_id: -1001,
      option_id: '',
      message_ids: [42],
      text: '',
    })
    expect(answer).toMatchObject({ reported: false, title: '举报这条消息' })
    expect(answer.options?.[0]?.text).toBe('垃圾信息')
  })

  it('sends the chosen reason and the comment back verbatim', async () => {
    const { deps, calls } = makeDeps((method) =>
      method._ === 'reportChat' ? { _: 'reportChatResultOk' } : null,
    )

    await expect(
      reportMessage(deps, { chatId: 1, messageId: 2, optionId: 'c3BhbQ==', text: '说明' }),
    ).resolves.toEqual({ reported: true })
    expect(calls[0]).toMatchObject({ option_id: 'c3BhbQ==', message_ids: [2], text: '说明' })
  })
})
describe('setUserContact (添加 / 删除联系人)', () => {
  /**
   * TDLib answers `addContact` with Ok *before* `user.is_contact` flips —
   * measured at ~1.2 s on the test DC — and the card paints straight from this
   * answer, so the action has to wait for the flag instead of reading it once.
   */
  it('waits for the contact flag that TDLib applies asynchronously', async () => {
    let getUserCalls = 0
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'addContact') return { _: 'ok' }
      if (method._ === 'getUser') {
        getUserCalls += 1
        return {
          _: 'user',
          id: 42,
          first_name: 'Ada',
          last_name: '',
          // The first read is still the old object; the next one has the flag.
          is_contact: getUserCalls > 1,
        }
      }
      if (method._ === 'getUserFullInfo') return { _: 'userFullInfo', group_in_common_count: 0 }
      if (method._ === 'createPrivateChat') return { _: 'chat', id: 42, can_be_reported: false }
      return null
    })

    const profile = await setUserContact(deps, { userId: 42, contact: true })

    expect(profile.isContact).toBe(true)
    // The name comes first (TDLib wants non-empty names), the add second.
    expect(calls[0]).toMatchObject({ _: 'getUser', user_id: 42 })
    expect(calls[1]).toEqual({
      _: 'addContact',
      user_id: 42,
      contact: {
        _: 'importedContact',
        phone_number: '',
        first_name: 'Ada',
        last_name: '',
        note: null,
      },
      share_phone_number: false,
    })
  })

  it('deletes through removeContacts and reads the flag back', async () => {
    const { deps, calls } = makeDeps((method) => {
      if (method._ === 'removeContacts') return { _: 'ok' }
      if (method._ === 'getUser') {
        return { _: 'user', id: 7, first_name: 'Bob', last_name: '', is_contact: false }
      }
      if (method._ === 'getUserFullInfo') return { _: 'userFullInfo', group_in_common_count: 0 }
      if (method._ === 'createPrivateChat') return { _: 'chat', id: 7, can_be_reported: false }
      return null
    })

    const profile = await setUserContact(deps, { userId: 7, contact: false })

    expect(profile.isContact).toBe(false)
    expect(calls[0]).toEqual({ _: 'removeContacts', user_ids: [7] })
  })
})
