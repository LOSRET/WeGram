import { describe, expect, it } from 'vitest'

import { filterTopics, orderTopics, pageTopics } from './topics'

const topic = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `话题 ${id}`,
  isPinned: false,
  isGeneral: false,
  lastMessageAt: id,
  ...overrides,
})

describe('orderTopics', () => {
  it('puts pinned first, then General, then newest activity', () => {
    const ordered = orderTopics([
      topic(5, { lastMessageAt: 50 }),
      topic(1, { isGeneral: true }),
      topic(7, { isPinned: true, lastMessageAt: 1 }),
      topic(6, { lastMessageAt: 99 }),
    ])
    expect(ordered.map((entry) => entry.id)).toEqual([7, 1, 6, 5])
  })

  it('does not mutate the input', () => {
    const input = [topic(1), topic(2, { isPinned: true })]
    orderTopics(input)
    expect(input.map((entry) => entry.id)).toEqual([1, 2])
  })
})

describe('filterTopics', () => {
  it('matches the name, case-insensitively', () => {
    const topics = [topic(1, { title: '版本发布' }), topic(2, { title: '闲聊' })]
    expect(filterTopics(topics, '版本').map((entry) => entry.id)).toEqual([1])
    expect(filterTopics(topics, '').map((entry) => entry.id)).toEqual([1, 2])
    expect(filterTopics(topics, '不存在')).toEqual([])
  })
})

describe('pageTopics', () => {
  it('pages after the cursor and reports the last page', () => {
    const topics = [topic(1), topic(2), topic(3)]
    const first = pageTopics(topics, undefined, 2)
    expect(first.topics.map((entry) => entry.id)).toEqual([1, 2])
    expect(first.nextTopicId).toBe(2)
    const second = pageTopics(topics, 2, 2)
    expect(second.topics.map((entry) => entry.id)).toEqual([3])
    expect(second.nextTopicId).toBeNull()
  })

  it('starts over when the cursor row is gone', () => {
    expect(pageTopics([topic(1), topic(2)], 99, 1).topics.map((entry) => entry.id)).toEqual([1])
  })
})