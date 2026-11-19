import { describe, expect, it } from 'vitest'

import { mapContactProfile } from './contact'

describe('mapContactProfile', () => {
  it('maps the identity a contact pane shows', () => {
    const profile = mapContactProfile(7, {
      _: 'user',
      id: 42,
      first_name: 'Ada',
      last_name: 'Lovelace',
      usernames: { _: 'usernames', active_usernames: ['ada'], editable_username: 'ada' },
      phone_number: '+441234',
    })
    expect(profile).toEqual({ chatId: 7, userId: 42, username: 'ada', phone: '+441234' })
  })

  it('drops the fields Telegram hides for non-contacts', () => {
    expect(mapContactProfile(7, { _: 'user', id: 42, first_name: 'Ada' })).toEqual({
      chatId: 7,
      userId: 42,
    })
  })

  it('keeps only the chat id when the peer is unknown', () => {
    expect(mapContactProfile(7, undefined)).toEqual({ chatId: 7 })
  })
})
