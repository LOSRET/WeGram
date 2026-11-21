import type { ChatSummary } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { ME, type Fixture } from './constants'
import { listMockContacts } from './contacts'

function fixture(
  chat: Partial<ChatSummary> & { id: number; title: string },
  contact?: Fixture['contact'],
): Fixture {
  return {
    chat: {
      kind: 'private',
      unread: 0,
      pinned: false,
      muted: false,
      ...chat,
    },
    messages: [],
    ...(contact ? { contact } : {}),
  }
}

describe('listMockContacts', () => {
  it('keeps people and drops our own Saved Messages and groups', () => {
    const fixtures = new Map<number, Fixture>([
      [1, fixture({ id: 1, title: '文件传输助手', userId: ME.id })],
      [2, fixture({ id: 2, title: '前端周会', kind: 'group' })],
      [3, fixture({ id: 3, title: '妈', userId: 37 }, { username: 'mama', phone: '+86 1' })],
    ])

    expect(listMockContacts(fixtures)).toEqual([
      { userId: 37, title: '妈', username: 'mama', phone: '+86 1' },
    ])
  })

  it('sorts by name and carries the chat photo when there is one', () => {
    const fixtures = new Map<number, Fixture>([
      [1, fixture({ id: 1, title: 'Zoe', userId: 5, avatarUrl: 'wx-media://f/1' })],
      [2, fixture({ id: 2, title: 'Ada', userId: 6 })],
    ])

    expect(listMockContacts(fixtures).map((contact) => contact.title)).toEqual(['Ada', 'Zoe'])
    expect(listMockContacts(fixtures)[1]?.avatarUrl).toBe('wx-media://f/1')
  })
})
