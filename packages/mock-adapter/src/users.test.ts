import { describe, expect, it } from 'vitest'

import { ME, type Fixture } from './constants'
import { createMockUsers } from './users'

function fixture(overrides: Partial<Fixture['contact']> = {}): Map<number, Fixture> {
  const map = new Map<number, Fixture>()
  map.set(3, {
    chat: {
      id: 3,
      title: '妈',
      kind: 'private',
      userId: 37,
      unread: 0,
      pinned: false,
      muted: false,
    },
    messages: [],
    contact: { username: 'mama_wegram', phone: '8613800000000', bio: '散步', ...overrides },
  })
  map.set(1, {
    chat: {
      id: 1,
      title: '自己',
      kind: 'private',
      userId: ME.id,
      unread: 0,
      pinned: false,
      muted: false,
    },
    messages: [],
  })
  return map
}

describe('createMockUsers', () => {
  it('reads the card off the fixture contact', async () => {
    const users = createMockUsers(fixture())

    await expect(users.profile({ userId: 37 })).resolves.toMatchObject({
      userId: 37,
      title: '妈',
      username: 'mama_wegram',
      phone: '8613800000000',
      bio: '散步',
      isContact: true,
      blocked: false,
    })
  })

  it('keeps a written 备注 and clears it with an empty one', async () => {
    const users = createMockUsers(fixture())

    await expect(users.setNote({ userId: 37, note: ' 妈妈 ' })).resolves.toMatchObject({
      note: '妈妈',
    })
    // An empty box clears the note even though the fixture ships one: the
    // override wins, including over the seed's own 备注.
    const cleared = await users.setNote({ userId: 37, note: '' })
    expect(cleared.note).toBeUndefined()
  })

  it('flips the contact flag, which is the card button reads', async () => {
    const users = createMockUsers(fixture())

    await expect(users.setContact({ userId: 37, contact: false })).resolves.toMatchObject({
      isContact: false,
    })
    await expect(users.setContact({ userId: 37, contact: true })).resolves.toMatchObject({
      isContact: true,
    })
  })

  it('refuses a user the fake account does not have', async () => {
    const users = createMockUsers(fixture())
    await expect(users.profile({ userId: 999 })).rejects.toMatchObject({ code: 'invalid_payload' })
  })
})
