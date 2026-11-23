import { describe, expect, it } from 'vitest'

import type { ChatTopic } from '@wegram/protocol'

import type { Fixture } from './constants'
import { createMockTopics } from './topics'

function topic(overrides: Partial<ChatTopic> = {}): ChatTopic {
  return {
    id: 1,
    title: '综合',
    isGeneral: true,
    isClosed: false,
    isPinned: false,
    muted: false,
    iconColor: 0x6fb9f0,
    unread: 0,
    ...overrides,
  }
}

function makeFixture(topics: ChatTopic[]): Fixture {
  return {
    chat: {
      id: 12,
      title: '开发组',
      kind: 'group',
      unread: 0,
      pinned: false,
      muted: false,
      forum: true,
      canCreateTopic: true,
    },
    topics,
    messages: [],
  }
}

function setup(topics: ChatTopic[]) {
  const fixture = makeFixture(topics)
  const events: string[] = []
  const api = createMockTopics({
    fixtures: new Map([[12, fixture]]),
    emit: (event) => events.push(event.type),
  })
  return { api, fixture, events }
}

describe('mock topics', () => {
  it('orders pinned first, then General, then newest activity', async () => {
    const { api } = setup([
      topic({ id: 5, title: '闲聊', isGeneral: false, lastMessageAt: 10 }),
      topic({ id: 1, title: '综合', isGeneral: true }),
      topic({ id: 7, title: '公告', isGeneral: false, isPinned: true, lastMessageAt: 1 }),
      topic({ id: 6, title: '版本', isGeneral: false, lastMessageAt: 99 }),
    ])
    const page = await api.list({ chatId: 12 })
    expect(page.topics.map((entry) => entry.id)).toEqual([7, 1, 6, 5])
    expect(page.next).toBeNull()
  })

  it('searches names and pages past the last topic of the page', async () => {
    const { api } = setup([
      topic({ id: 1 }),
      topic({ id: 2, title: '版本发布', isGeneral: false, lastMessageAt: 30 }),
      topic({ id: 3, title: '版本回滚', isGeneral: false, lastMessageAt: 20 }),
    ])
    const first = await api.list({ chatId: 12, limit: 2 })
    expect(first.topics).toHaveLength(2)
    expect(first.next).not.toBeNull()
    const second = await api.list({ chatId: 12, limit: 2, cursor: first.next ?? undefined })
    expect(second.topics.map((entry) => entry.id)).toEqual([3])
    expect(second.next).toBeNull()

    const found = await api.list({ chatId: 12, query: '回滚' })
    expect(found.topics.map((entry) => entry.id)).toEqual([3])
  })

  it('creates a topic without reusing General and announces the change', async () => {
    const { api, fixture, events } = setup([topic({ id: 1 }), topic({ id: 4, isGeneral: false })])
    const created = await api.create({ chatId: 12, title: '新话题', iconColor: 0xff93b2 })
    expect(created.id).toBe(5)
    expect(created.isGeneral).toBe(false)
    expect(fixture.topics?.map((entry) => entry.title)).toContain('新话题')
    expect(events).toContain('topics')
  })

  it('closing and pinning rewrite the row', async () => {
    const { api, fixture } = setup([topic({ id: 9, isGeneral: false })])
    await api.setClosed(12, 9, true)
    await api.setPinned(12, 9, true)
    expect(fixture.topics?.[0]).toMatchObject({ isClosed: true, isPinned: true })
  })

  it('marking a topic read clears only that topic and re-sums the chat', async () => {
    const { api, fixture } = setup([
      topic({ id: 1, unread: 2 }),
      topic({ id: 2, isGeneral: false, unread: 3 }),
    ])
    await api.markRead(12, 2, 400)
    expect(fixture.topics?.[1]).toMatchObject({ unread: 0, lastReadInboxMessageId: 400 })
    expect(fixture.chat.unread).toBe(2)
  })

  it('deleting a topic drops its messages too', async () => {
    const { api, fixture } = setup([topic({ id: 1 }), topic({ id: 2, isGeneral: false })])
    fixture.messages = [
      { id: 1, chatId: 12, senderId: 1, senderName: 'a', outgoing: false, date: 1, kind: 'text', text: 'a', topicId: 1 },
      { id: 2, chatId: 12, senderId: 1, senderName: 'a', outgoing: false, date: 2, kind: 'text', text: 'b', topicId: 2 },
    ]
    await api.remove(12, 2)
    expect(fixture.topics?.map((entry) => entry.id)).toEqual([1])
    expect(fixture.messages.map((message) => message.id)).toEqual([1])
  })

  it('muting one topic rewrites just that row', async () => {
    const { api, fixture } = setup([
      topic({ id: 1 }),
      topic({ id: 2, isGeneral: false }),
    ])
    await api.setMuted(12, 2, true)
    expect(fixture.topics?.[1]?.muted).toBe(true)
    expect(fixture.topics?.[0]?.muted).toBe(false)
  })

  it('offers the icon emoji the mock can render', async () => {
    const { api } = setup([topic()])
    const icons = await api.icons()
    expect(icons.length).toBeGreaterThan(0)
    expect(icons.every((icon) => icon.id !== '0' && icon.emoji !== '')).toBe(true)
  })

  it('a link carries the chat and the topic', async () => {
    const { api } = setup([topic({ id: 3, isGeneral: false })])
    await expect(api.link(12, 3)).resolves.toEqual({ link: 'https://t.me/c/12/3' })
    await expect(api.link(12, 999)).resolves.toBeNull()
  })
})