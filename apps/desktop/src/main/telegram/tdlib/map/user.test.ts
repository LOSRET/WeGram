import { describe, expect, it } from 'vitest'

import type { TdObject } from '../client'
import type { MapperContext } from './context'
import { mapUserProfile } from './user'

function ctx(overrides: Partial<MapperContext> = {}): MapperContext {
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

function user(overrides: Partial<TdObject> = {}): TdObject {
  return {
    id: 37,
    first_name: '妈妈',
    last_name: '',
    usernames: { active_usernames: ['mama_wegram'] },
    phone_number: '8613800000000',
    is_contact: true,
    ...overrides,
  }
}

describe('mapUserProfile', () => {
  it('reads the card out of user + userFullInfo', () => {
    const profile = mapUserProfile(
      ctx(),
      user(),
      {
        bio: { _: 'formattedText', text: '每天散步一小时。' },
        note: { _: 'formattedText', text: '妈妈' },
        group_in_common_count: 3,
        block_list: null,
      },
      false,
    )

    expect(profile).toMatchObject({
      userId: 37,
      title: '妈妈',
      username: 'mama_wegram',
      phone: '8613800000000',
      bio: '每天散步一小时。',
      note: '妈妈',
      commonChats: 3,
      isContact: true,
      blocked: false,
    })
  })

  it('drops empty text so the card draws no empty rows', () => {
    const profile = mapUserProfile(
      ctx(),
      user(),
      {
        bio: { _: 'formattedText', text: '  ' },
        note: { _: 'formattedText', text: '' },
        group_in_common_count: 0,
        block_list: null,
      },
      false,
    )

    // TDLib hands back an empty formattedText where there is nothing to say.
    expect(profile.bio).toBeUndefined()
    expect(profile.note).toBeUndefined()
    expect(profile.commonChats).toBe(0)
  })

  it("carries TDLib's reportability for the private chat", () => {
    const bot = mapUserProfile(ctx(), user({ is_bot: true }), undefined, true)
    expect(bot.canBeReported).toBe(true)

    // A human's chat answers `can_be_reported: false`: TDLib only reports bots
    // from a profile (`UserManager::can_report_user` requires `is_bot`).
    const human = mapUserProfile(ctx(), user(), undefined, false)
    expect(human.canBeReported).toBe(false)
  })

  it('reads 已拉黑 from a non-null block list, and a person outside the book', () => {
    const profile = mapUserProfile(
      ctx(),
      user({ is_contact: false, first_name: '', last_name: '' }),
      { block_list: { _: 'blockListMain' }, group_in_common_count: 0 },
      false,
    )

    expect(profile.blocked).toBe(true)
    expect(profile.isContact).toBe(false)
    // Falls back to the username, then to the id: a name is never blank.
    expect(profile.title).toBe('mama_wegram')
  })

  it('takes the photo from the avatar cache when it is already on disk', () => {
    const avatars = new Map<number, string>([[37, 'wx-media://f/abc']])
    const profile = mapUserProfile(ctx({ userAvatarUrls: avatars }), user(), undefined, false)

    expect(profile.avatarUrl).toBe('wx-media://f/abc')
  })
})
