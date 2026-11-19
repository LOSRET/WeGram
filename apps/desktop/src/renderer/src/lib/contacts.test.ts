import type { Contact } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { contactInitial, groupContacts } from './contacts'

function contact(overrides: Partial<Contact>): Contact {
  return {
    userId: 1,
    title: 'Ada',
    ...overrides,
  }
}

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
      contact({ userId: 1, title: 'Zoe' }),
      contact({ userId: 2, title: '陈晨' }),
      contact({ userId: 3, title: 'Ada' }),
      contact({ userId: 4, title: 'Ben' }),
      contact({ userId: 5, title: '🎉 群' }),
    ])

    expect(groups.map((group) => group.initial)).toEqual(['A', 'B', 'C', 'Z', '#'])
    expect(groups[0]?.contacts.map((item) => item.title)).toEqual(['Ada'])
    expect(groups[2]?.contacts.map((item) => item.title)).toEqual(['陈晨'])
    expect(groups[4]?.contacts.map((item) => item.title)).toEqual(['🎉 群'])
  })

  it('keeps two people sharing an initial in one group', () => {
    const groups = groupContacts([
      contact({ userId: 1, title: 'Anna' }),
      contact({ userId: 2, title: 'Abe' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.contacts.map((item) => item.title)).toEqual(['Abe', 'Anna'])
  })
})
