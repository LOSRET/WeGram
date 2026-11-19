import { describe, expect, it } from 'vitest'

import type { MapperContext } from './context'
import { mapContact } from './contact'

function context(avatars: Record<number, string> = {}): MapperContext {
  return {
    chatTitles: new Map(),
    chatAvatarUrls: new Map(),
    userAvatarUrls: new Map(Object.entries(avatars).map(([id, url]) => [Number(id), url])),
    stickerSizes: new Map(),
    resolveUserName: async (userId) => `user-${userId}`,
    resolveChatTitle: async (chatId) => `chat-${chatId}`,
    prefetchUserAvatars: () => undefined,
  }
}

describe('mapContact', () => {
  it('maps an address-book user into a contact row', () => {
    const contact = mapContact(context({ 42: 'wx-media://f/avatar' }), {
      _: 'user',
      id: 42,
      first_name: 'Ada',
      last_name: 'Lovelace',
      usernames: { _: 'usernames', active_usernames: ['ada'], editable_username: 'ada' },
      phone_number: '+441234',
    })
    expect(contact).toEqual({
      userId: 42,
      title: 'Ada Lovelace',
      username: 'ada',
      phone: '+441234',
      avatarUrl: 'wx-media://f/avatar',
    })
  })

  it('drops the identity Telegram hides and keeps the name', () => {
    expect(mapContact(context(), { _: 'user', id: 42, first_name: 'Ada' })).toEqual({
      userId: 42,
      title: 'Ada',
    })
  })

  it('falls back to the username, then the id, when the name is empty', () => {
    expect(
      mapContact(context(), {
        _: 'user',
        id: 42,
        first_name: '',
        usernames: { _: 'usernames', active_usernames: ['ada'], editable_username: 'ada' },
      }).title,
    ).toBe('ada')
    expect(mapContact(context(), { _: 'user', id: 42, first_name: '' }).title).toBe('用户 42')
  })
})
