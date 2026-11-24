import { describe, expect, it } from 'vitest'

import {
  createTopic,
  DEFAULT_TOPIC_ICONS,
  filterTopics,
  orderTopics,
  pageTopics,
  removeTopic,
  setTopicFlag,
  sumTopicUnread,
  topicEditPatch,
  topicListPage,
  topicRead,
} from './topics'

const topic = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `话题 ${id}`,
  isPinned: false,
  isGeneral: false,
  isClosed: false,
  muted: false,
  iconColor: 0x6fb9f0,
  unread: 0,
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

describe('createTopic', () => {
  it('allocates one past the highest id and starts unread and unclosed', () => {
    const created = createTopic([topic(1), topic(4, { isGeneral: false })], {
      title: '新话题',
      iconColor: 0xff93b2,
    })
    expect(created).toMatchObject({
      id: 5,
      title: '新话题',
      isGeneral: false,
      isClosed: false,
      isPinned: false,
      muted: false,
      unread: 0,
    })
    expect(created).not.toHaveProperty('iconEmojiId')
  })

  it('keeps an icon emoji but treats 0 as none', () => {
    expect(createTopic([], { title: 'a', iconColor: 1, iconEmojiId: '7001' })).toMatchObject({
      iconEmojiId: '7001',
    })
    expect(createTopic([], { title: 'a', iconColor: 1, iconEmojiId: '0' })).not.toHaveProperty(
      'iconEmojiId',
    )
  })
})

describe('topicEditPatch', () => {
  it('keeps an empty name and an absent icon', () => {
    expect(topicEditPatch({})).toEqual({})
    expect(topicEditPatch({ title: '' })).toEqual({})
  })

  it('renames, sets an icon, and removes one with 0', () => {
    expect(topicEditPatch({ title: '版本' })).toEqual({ title: '版本' })
    expect(topicEditPatch({ iconEmojiId: '7002' })).toEqual({ iconEmojiId: '7002' })
    expect(topicEditPatch({ iconEmojiId: '0' })).toEqual({ iconEmojiId: undefined })
  })
})

describe('setTopicFlag', () => {
  it('rewrites one row and leaves the others alone', () => {
    const rows = [topic(1), topic(2, { isGeneral: false })]
    const next = setTopicFlag(rows, 2, 'isPinned', true)
    expect(next[1]).toMatchObject({ isPinned: true, isClosed: false, muted: false })
    expect(next[0]).toEqual(rows[0])
    expect(rows[1]?.isPinned).toBe(false)
  })
})

describe('removeTopic', () => {
  it('drops just that id', () => {
    expect(removeTopic([topic(1), topic(2)], 2).map((entry) => entry.id)).toEqual([1])
  })
})

describe('topicListPage', () => {
  it('pages by cursor and hands back the three-part next cursor', () => {
    const rows = [
      topic(1, { title: '综合', isGeneral: true }),
      topic(2, { title: '版本', lastMessageAt: 30, lastMessageId: 22 }),
      topic(3, { title: '闲聊', lastMessageAt: 20 }),
    ]
    const first = topicListPage(rows, { limit: 2 })
    expect(first.topics.map((entry) => entry.id)).toEqual([1, 2])
    expect(first.totalCount).toBe(3)
    expect(first.next).toEqual({ date: 30, messageId: 22, topicId: 2 })
    const second = topicListPage(rows, { limit: 2, cursor: { topicId: 2 } })
    expect(second.topics.map((entry) => entry.id)).toEqual([3])
    expect(second.next).toBeNull()
  })

  it('searches names and clamps the page size', () => {
    const rows = [topic(1, { title: '版本发布' }), topic(2, { title: '闲聊' })]
    expect(topicListPage(rows, { query: '版本' }).topics.map((entry) => entry.id)).toEqual([1])
    expect(topicListPage(rows, { limit: 0 }).topics).toHaveLength(1)
  })

  it('copies the rows out of the store', () => {
    const rows = [topic(1)]
    const page = topicListPage(rows)
    const row = page.topics[0]
    if (!row) throw new Error('no topic')
    row.title = 'changed'
    expect(rows[0]?.title).toBe('话题 1')
  })
})

describe('topicRead', () => {
  it('moves one topic\u2019s marker forward and re-sums nothing on its own', () => {
    const rows = [topic(1, { unread: 2 }), topic(2, { isGeneral: false, unread: 3 })]
    const read = topicRead(rows, 2, [{ id: 300, outgoing: true }], 400)
    expect(read?.topics[1]).toMatchObject({ unread: 0, lastReadInboxMessageId: 400 })
    expect(read?.topics[0]).toEqual(rows[0])
    expect(read?.state).toEqual({ lastReadInboxMessageId: 400, unread: 0 })
  })

  it('never moves the marker backwards', () => {
    const rows = [topic(2, { lastReadInboxMessageId: 400 })]
    const read = topicRead(rows, 2, [{ id: 300, outgoing: false }], 300)
    expect(read?.state.lastReadInboxMessageId).toBe(400)
  })

  it('answers null for a topic that is gone', () => {
    expect(topicRead([], 9, [], 1)).toBeNull()
  })
})

describe('sumTopicUnread', () => {
  it('adds the topics up', () => {
    expect(sumTopicUnread([{ unread: 2 }, { unread: 3 }])).toBe(5)
    expect(sumTopicUnread([])).toBe(0)
  })
})

describe('DEFAULT_TOPIC_ICONS', () => {
  it('offers renderable custom-emoji ids', () => {
    expect(DEFAULT_TOPIC_ICONS.length).toBeGreaterThan(0)
    expect(DEFAULT_TOPIC_ICONS.every((icon) => icon.id !== '0' && icon.emoji !== '')).toBe(true)
  })
})
