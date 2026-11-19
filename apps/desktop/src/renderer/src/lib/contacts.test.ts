import type { ChatSummary } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { contactChats, contactInitial, groupContacts } from './contacts'

function chat(overrides: Partial<ChatSummary>): ChatSummary {
  return {
    id: 1,
    title: 'Ada',
    kind: 'private',
    unread: 0,
    pinned: false,
    muted: false,
    ...overrides,
  }
}

describe('contactChats', () => {
  it('keeps private chats and drops groups, channels and Saved Messages', () => {
    const result = contactChats(
      [
        chat({ id: 1, title: 'Ada' }),
        chat({ id: 2, title: 'Team', kind: 'group' }),
        chat({ id: 3, title: 'News', kind: 'channel' }),
        chat({ id: 4, title: 'Saved Messages', userId: 1000 }),
        chat({ id: 5, title: 'Ben', userId: 42 }),
      ],
      1000,
    )

    expect(result.map((item) => item.id)).toEqual([1, 5])
  })

  it('keeps a chat whose peer id the adapter did not fill in', () => {
    expect(contactChats([chat({ id: 1, userId: undefined })], 1000)).toHaveLength(1)
  })

  it('does not filter anything before the account id is known', () => {
    expect(contactChats([chat({ id: 1, userId: 1000 })], null)).toHaveLength(1)
  })
})

describe('contactInitial', () => {
  it('upper-cases a Latin initial and ignores surrounding spaces', () => {
    expect(contactInitial(' ada ')).toBe('A')
    expect(contactInitial('Zoe')).toBe('Z')
  })

  it('uses the pinyin initial of a Han name', () => {
    expect(contactInitial('陈晨')).toBe('C')
    expect(contactInitial('妈')).toBe('M')
    expect(contactInitial('张')).toBe('Z')
    expect(contactInitial('爱')).toBe('A')
    expect(contactInitial('鱼')).toBe('Y')
  })

  it('puts digits, symbols and empty names into the # bucket', () => {
    expect(contactInitial('123')).toBe('#')
    expect(contactInitial('🎉')).toBe('#')
    expect(contactInitial('')).toBe('#')
  })
})

describe('groupContacts', () => {
  it('orders A–Z, puts # last and sorts inside a bucket', () => {
    const groups = groupContacts([
      chat({ id: 1, title: 'Zoe' }),
      chat({ id: 2, title: '陈晨' }),
      chat({ id: 3, title: 'Ada' }),
      chat({ id: 4, title: 'Ben' }),
      chat({ id: 5, title: '🎉 群' }),
    ])

    expect(groups.map((group) => group.initial)).toEqual(['A', 'B', 'C', 'Z', '#'])
    expect(groups[0]?.contacts.map((item) => item.title)).toEqual(['Ada'])
    expect(groups[2]?.contacts.map((item) => item.title)).toEqual(['陈晨'])
    expect(groups[4]?.contacts.map((item) => item.title)).toEqual(['🎉 群'])
  })

  it('keeps two people sharing an initial in one group', () => {
    const groups = groupContacts([chat({ id: 1, title: 'Anna' }), chat({ id: 2, title: 'Abe' })])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.contacts.map((item) => item.title)).toEqual(['Abe', 'Anna'])
  })
})
