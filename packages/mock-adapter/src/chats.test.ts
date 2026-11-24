import type { AdapterEvent } from '@wegram/adapter-contract'
import type { ChatSummary } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { addMockChatMember, listMockChats, setMockArchived, type MockChatStore } from './chats'
import type { Fixture } from './constants'

/**
 * The fake account's two lists. Archiving is a list move in TDLib, so the mock
 * answers `chats:list { list: 'archive' }` from the same flag the renderer routes
 * the upsert by.
 */

function chat(id: number, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    title: `chat-${id}`,
    kind: 'private',
    unread: 0,
    pinned: false,
    muted: false,
    lastMessageAt: 1_700_000_000 - id,
    ...overrides,
  }
}

const events: AdapterEvent[] = []

function store(...chats: ChatSummary[]): MockChatStore {
  const fixtures = new Map<number, Fixture>()
  for (const item of chats) fixtures.set(item.id, { chat: item, messages: [] })
  return { fixtures, emit: (event: AdapterEvent) => events.push(event) }
}

describe('listMockChats', () => {
  it('serves the main list without the archived chats', () => {
    const fake = store(chat(1), chat(2, { archived: true }))
    expect(listMockChats(fake, { limit: 10, offset: 0 }).map((item) => item.id)).toEqual([1])
  })

  it('serves the archive as its own list, pinned first', () => {
    const fake = store(
      chat(1),
      chat(2, { archived: true }),
      chat(3, { archived: true, pinned: true }),
    )
    const page = listMockChats(fake, { limit: 10, offset: 0, list: 'archive' })
    expect(page.map((item) => item.id)).toEqual([3, 2])
  })

  it('pages with the same offset rule as the main list', () => {
    const fake = store(
      chat(1, { archived: true }),
      chat(2, { archived: true }),
      chat(3, { archived: true }),
    )
    const page = listMockChats(fake, { limit: 1, offset: 1, list: 'archive' })
    expect(page.map((item) => item.id)).toEqual([2])
  })
})

/**
 * 添加成员 (§8.3): a bot joins a group by @username, which is the only id it has.
 * The fixture has no member table, so the answer is who *would* be added.
 */
describe('addMockChatMember', () => {
  function groupStore(): MockChatStore {
    const fake = store(chat(13, { kind: 'group' }))
    fake.fixtures.set(26, {
      chat: chat(26, { kind: 'private', userId: 26, title: 'WeGram 助手' }),
      messages: [],
      bot: { username: 'wegram_helper', commands: [] },
    })
    fake.fixtures.set(27, {
      chat: chat(27, { kind: 'private', userId: 27, title: '妈' }),
      messages: [],
      contact: { username: 'mama_wegram' },
    })
    return fake
  }

  it('answers the bot behind an @username', () => {
    expect(addMockChatMember(groupStore(), 13, '@wegram_helper')).toEqual({
      userId: 26,
      title: 'WeGram 助手',
    })
  })

  it('answers a person the fixture knows, with or without the @', () => {
    expect(addMockChatMember(groupStore(), 13, 'mama_wegram')).toEqual({
      userId: 27,
      title: '妈',
    })
  })

  it('refuses an unknown handle and a private chat', () => {
    expect(() => addMockChatMember(groupStore(), 13, '@nobody')).toThrow('找不到 @nobody')
    expect(() => addMockChatMember(groupStore(), 26, '@wegram_helper')).toThrow('私聊不能添加成员')
  })
})

describe('setMockArchived', () => {
  it('moves the chat between the lists and announces the summary', () => {
    events.length = 0
    const fake = store(chat(1))
    const archived = setMockArchived(fake, 1, true)
    expect(archived.archived).toBe(true)
    expect(listMockChats(fake, { limit: 10, offset: 0 })).toHaveLength(0)
    expect(listMockChats(fake, { limit: 10, offset: 0, list: 'archive' }).map((c) => c.id)).toEqual(
      [1],
    )
    expect(events).toEqual([
      {
        type: 'chats',
        ops: [{ op: 'upsert', chat: expect.objectContaining({ id: 1, archived: true }) }],
      },
    ])
  })

  it('unarchives by clearing the flag', () => {
    events.length = 0
    const fake = store(chat(1, { archived: true }))
    const restored = setMockArchived(fake, 1, false)
    expect(restored.archived).toBe(false)
    expect(listMockChats(fake, { limit: 10, offset: 0 }).map((c) => c.id)).toEqual([1])
  })
})
