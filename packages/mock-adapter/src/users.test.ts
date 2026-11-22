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
      // A human is not reportable from a profile; TDLib's flag wants a bot.
      canBeReported: false,
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

/** The person from `fixture()` plus one group they share with the account. */
function fixtureWithGroup(): Map<number, Fixture> {
  const map = fixture()
  map.set(2, {
    chat: {
      id: 2,
      title: 'WeGram 产品群',
      kind: 'group',
      unread: 0,
      pinned: false,
      muted: false,
    },
    messages: [],
  })
  const person = map.get(3)
  if (!person) throw new Error('fixture 3 is missing')
  // One id resolves to the group above; the other is gone, like a chat TDLib
  // dropped from the list after the id was cached.
  person.commonChatIds = [2, 404]
  return map
}

describe('共同群聊', () => {
  it('counts the groups the fixture says are shared', async () => {
    const users = createMockUsers(fixtureWithGroup())
    await expect(users.profile({ userId: 37 })).resolves.toMatchObject({ commonChats: 1 })
  })

  it('answers the shared groups as chat rows and skips an id that is gone', async () => {
    const users = createMockUsers(fixtureWithGroup())
    await expect(users.commonChats({ userId: 37 })).resolves.toMatchObject([
      { id: 2, title: 'WeGram 产品群', kind: 'group' },
    ])
  })

  it("pages from TDLib's offset chat id", async () => {
    const users = createMockUsers(fixtureWithGroup())
    await expect(users.commonChats({ userId: 37, offset: 2 })).resolves.toEqual([
      { id: 2, title: 'WeGram 产品群', kind: 'group', unread: 0, pinned: false, muted: false },
    ])
  })
})

describe('block and report', () => {
  it('marks the person blocked and answers the refreshed card', async () => {
    const users = createMockUsers(fixture())
    await expect(users.setBlocked({ userId: 37, blocked: true })).resolves.toMatchObject({
      blocked: true,
    })
    await expect(users.setBlocked({ userId: 37, blocked: false })).resolves.toMatchObject({
      blocked: false,
    })
  })

  it('answers the reasons first and files the report on the second call', async () => {
    const users = createMockUsers(fixture())

    const first = await users.report({ userId: 37 })
    expect(first.reported).toBe(false)
    expect(first.options?.length).toBeGreaterThan(1)

    const second = await users.report({ userId: 37, optionId: first.options?.[0]?.id })
    expect(second.reported).toBe(true)
  })

  it('offers the whole ReportReason taxonomy, not a shortlist', async () => {
    const users = createMockUsers(fixture())

    const first = await users.report({ userId: 37 })

    expect(first.options?.map((option) => option.text)).toEqual([
      '垃圾信息',
      '假冒账号',
      '涉及暴力或危险行为',
      '儿童虐待',
      '色情内容',
      '非法毒品',
      '泄露个人信息',
      '侵犯版权',
      '其他',
    ])
  })

  it('asks for details on 其他 before filing, like reportChatResultTextRequired', async () => {
    const users = createMockUsers(fixture())

    const step = await users.report({ userId: 37, optionId: 'other' })
    expect(step).toMatchObject({
      reported: false,
      textRequired: true,
      optionId: 'other-details',
    })

    await expect(
      users.report({ userId: 37, optionId: 'other-details', text: '说明' }),
    ).resolves.toEqual({ reported: true })
  })

  it('files a one-message report through the same two phases', async () => {
    const users = createMockUsers(fixture())

    const first = await users.reportMessage({ chatId: 3, messageId: 301 })
    expect(first.reported).toBe(false)
    expect(first.options?.length).toBeGreaterThan(1)

    const second = await users.reportMessage({
      chatId: 3,
      messageId: 301,
      optionId: first.options?.[1]?.id ?? 'spam',
    })
    expect(second.reported).toBe(true)
  })
})
