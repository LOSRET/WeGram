import type { ChatSummary, Message, MessageOp } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import {
  EMPTY_MESSAGES,
  PENDING_OPS_LIMIT,
  appendNewerMessages,
  hasReplayableOps,
  mergeChatList,
  reduceOps,
  routeChatOps,
  sortChats,
  splitOpsForWindow,
} from './reducers'

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    chatId: 1,
    senderId: 1000,
    senderName: '测试',
    outgoing: false,
    date: 1_700_000_000 + id,
    kind: 'text',
    text: `m${id}`,
    ...overrides,
  }
}

const newOp = (id: number): MessageOp => ({ op: 'new', message: message(id) })
const deleteOp = (...ids: number[]): MessageOp => ({ op: 'delete', chatId: 1, messageIds: ids })
const readOp = (): MessageOp => ({ op: 'read', chatId: 1, upToMessageId: 5 })

describe('sortChats', () => {
  it('puts pinned chats first, then orders by last activity', () => {
    const chats = [
      { id: 1, title: 'old', kind: 'private', unread: 0, pinned: false, lastMessageAt: 100 },
      { id: 2, title: 'new', kind: 'private', unread: 0, pinned: false, lastMessageAt: 300 },
      { id: 3, title: 'pinned', kind: 'private', unread: 0, pinned: true, lastMessageAt: 1 },
    ]
    // The type is inferred from the real DTO in the store; this fixture is enough.
    expect(sortChats(chats as never).map((chat) => chat.id)).toEqual([3, 2, 1])
  })

  it('does not mutate the input array', () => {
    const chats = [
      { id: 1, title: 'a', kind: 'private', unread: 0, pinned: false, lastMessageAt: 1 },
      { id: 2, title: 'b', kind: 'private', unread: 0, pinned: false, lastMessageAt: 2 },
    ]
    const before = [...chats]
    sortChats(chats as never)
    expect(chats).toEqual(before)
  })

  it('treats a chat without a timestamp as the oldest', () => {
    const chats = [
      { id: 1, title: 'a', kind: 'private', unread: 0, pinned: false },
      { id: 2, title: 'b', kind: 'private', unread: 0, pinned: false, lastMessageAt: 5 },
    ]
    expect(sortChats(chats as never).map((chat) => chat.id)).toEqual([2, 1])
  })
})

describe('routeChatOps', () => {
  const chat = (id: number, overrides: Partial<ChatSummary> = {}): ChatSummary => ({
    id,
    title: `c${id}`,
    kind: 'private',
    unread: 0,
    pinned: false,
    muted: false,
    lastMessageAt: 1_700_000_000 - id,
    ...overrides,
  })

  it('moves an archived row out of the main list without a remove op', () => {
    const lists = routeChatOps({ chats: [chat(1), chat(2)], archivedChats: [] }, [
      { op: 'upsert', chat: chat(1, { archived: true }) },
    ])
    expect(lists.chats.map((item) => item.id)).toEqual([2])
    expect(lists.archivedChats.map((item) => item.id)).toEqual([1])
    // Nothing was deleted: the transcript has to survive the move.
    expect(lists.removed).toEqual([])
  })

  it('moves an unarchived row back and keeps one copy of it', () => {
    const lists = routeChatOps({ chats: [], archivedChats: [chat(1, { archived: true })] }, [
      { op: 'upsert', chat: chat(1) },
    ])
    expect(lists.chats.map((item) => item.id)).toEqual([1])
    expect(lists.archivedChats).toEqual([])
  })

  it('keeps the archive in the same order as the main list', () => {
    const lists = routeChatOps({ chats: [], archivedChats: [] }, [
      { op: 'upsert', chat: chat(1, { archived: true }) },
      { op: 'upsert', chat: chat(2, { archived: true, pinned: true }) },
      { op: 'upsert', chat: chat(3, { archived: true, lastMessageAt: 1_700_000_100 }) },
    ])
    expect(lists.archivedChats.map((item) => item.id)).toEqual([2, 3, 1])
  })

  it('drops a deleted chat from both lists and reports it', () => {
    const lists = routeChatOps(
      { chats: [chat(1)], archivedChats: [chat(2, { archived: true })] },
      [{ op: 'remove', chatId: 2 }],
    )
    expect(lists.chats.map((item) => item.id)).toEqual([1])
    expect(lists.archivedChats).toEqual([])
    expect(lists.removed).toEqual([2])
  })
})

describe('reduceOps', () => {
  it('appends a new message in arrival order', () => {
    const { list } = reduceOps([message(1)], [newOp(2), newOp(3)])
    expect(list.map((item) => item.id)).toEqual([1, 2, 3])
  })

  it('replaces in place when an id already exists (no duplicates)', () => {
    const { list } = reduceOps([message(1), message(2)], [newOp(1)])
    expect(list).toHaveLength(2)
    expect(list[0]?.text).toBe('m1')
  })

  it('replaces the whole message on a `replace` op (media/caption edits)', () => {
    const updated = message(2, { text: 'caption', kind: 'photo' })
    const { list } = reduceOps([message(1), message(2)], [{ op: 'replace', message: updated }])
    expect(list[1]).toEqual(updated)
  })

  it('patches text and marks the message edited on an `edit` op', () => {
    const { list } = reduceOps(
      [message(1), message(2)],
      [{ op: 'edit', chatId: 1, messageId: 2, text: 'edited' }],
    )
    expect(list[1]).toMatchObject({ id: 2, text: 'edited', edited: true })
  })

  it('removes deleted ids and reports them to the caller', () => {
    const { list, deleted } = reduceOps([message(1), message(2), message(3)], [deleteOp(2, 3)])
    expect(list.map((item) => item.id)).toEqual([1])
    expect([...deleted].sort()).toEqual([2, 3])
  })

  it('leaves the list untouched on read markers', () => {
    const before = [message(1)]
    const { list, deleted } = reduceOps(before, [readOp()])
    expect(list).toBe(before)
    expect(deleted.size).toBe(0)
  })

  it('never mutates the list it was handed', () => {
    const before = [message(1)]
    reduceOps(before, [newOp(2), deleteOp(1)])
    expect(before).toHaveLength(1)
  })

  it('applies a batch in order, so delete then new resurrects the id', () => {
    const { list } = reduceOps([message(1)], [deleteOp(1), newOp(1)])
    expect(list.map((item) => item.id)).toEqual([1])
  })
})

describe('hasReplayableOps', () => {
  it('skips a read-marker-only batch', () => {
    expect(hasReplayableOps([readOp()])).toBe(false)
    expect(hasReplayableOps([])).toBe(false)
  })

  it('keeps a batch that carries anything else', () => {
    expect(hasReplayableOps([readOp(), newOp(9)])).toBe(true)
    expect(hasReplayableOps([deleteOp(1)])).toBe(true)
  })
})

describe('splitOpsForWindow', () => {
  const window = [message(10), message(11), message(12)]

  it('applies rows inside the window and defers rows beyond its newest id', () => {
    const { applicable, deferred } = splitOpsForWindow(window, [newOp(11), newOp(13), deleteOp(10)])
    expect(applicable.map((op) => (op.op === 'new' ? op.message.id : op.op))).toEqual([
      11,
      'delete',
    ])
    // Splicing 13 under 12 would hide every message between them.
    expect(deferred.map((op) => (op.op === 'new' ? op.message.id : op.op))).toEqual([13])
  })

  it('drops rows older than the window instead of appending them at the end', () => {
    const { applicable, deferred } = splitOpsForWindow(window, [newOp(9), newOp(13)])
    expect(applicable).toHaveLength(0)
    expect(deferred).toHaveLength(1)
  })

  it('always applies id-only ops, which cannot invent a row', () => {
    const edit: MessageOp = { op: 'edit', chatId: 1, messageId: 11, text: 'x' }
    const { applicable } = splitOpsForWindow(window, [edit, readOp()])
    expect(applicable).toHaveLength(2)
  })
})

describe('appendNewerMessages', () => {
  it('appends only ids newer than the current tail, de-duplicated and ascending', () => {
    const list = appendNewerMessages([message(1), message(2)], [message(4), message(2), message(3)])
    expect(list.map((item) => item.id)).toEqual([1, 2, 3, 4])
  })

  it('returns the same list when nothing is newer', () => {
    const before = [message(1), message(2)]
    expect(appendNewerMessages(before, [message(1)])).toBe(before)
  })
})

describe('PENDING_OPS_LIMIT / EMPTY_MESSAGES', () => {
  it('bounds the replay queue so a cold chat cannot grow it without limit', () => {
    expect(PENDING_OPS_LIMIT).toBeGreaterThan(0)
    expect(PENDING_OPS_LIMIT).toBeLessThanOrEqual(1000)
  })

  it('shares one empty list, which callers must not mutate', () => {
    expect(EMPTY_MESSAGES).toEqual([])
  })
})
describe('reduceOps reactions', () => {
  const withReactions = (): Message =>
    message(1, { reactions: [{ emoji: '👍', count: 2, chosen: true }] })

  it('replaces the chips with the list TDLib sent', () => {
    const op: MessageOp = {
      op: 'reactions',
      chatId: 1,
      messageId: 1,
      reactions: [{ emoji: '🎉', count: 4 }],
    }
    const { list } = reduceOps([withReactions()], [op])
    // The update carries the complete list, so it is replaced — not merged.
    expect(list[0]?.reactions).toEqual([{ emoji: '🎉', count: 4 }])
  })

  it('removes the chips when the last reaction is taken back', () => {
    const op: MessageOp = { op: 'reactions', chatId: 1, messageId: 1, reactions: [] }
    const { list } = reduceOps([withReactions()], [op])
    expect(list[0]?.reactions).toBeUndefined()
  })

  it('leaves other rows alone', () => {
    const op: MessageOp = {
      op: 'reactions',
      chatId: 1,
      messageId: 2,
      reactions: [{ emoji: '👍', count: 1 }],
    }
    const { list } = reduceOps([withReactions(), message(2)], [op])
    expect(list[0]?.reactions).toEqual([{ emoji: '👍', count: 2, chosen: true }])
    expect(list[1]?.reactions).toEqual([{ emoji: '👍', count: 1 }])
  })
})

describe('mergeChatList (分页 + 事件断档修复)', () => {
  const chat = (id: number, lastMessageAt: number, pinned = false) => ({
    id,
    title: `chat ${id}`,
    kind: 'private' as const,
    unread: 0,
    pinned,
    lastMessageAt,
  })

  it('appends a page and keeps the order', () => {
    const current = [chat(2, 200), chat(1, 100)]
    const merged = mergeChatList(current as never, [chat(3, 300)] as never)
    expect(merged.map((row) => row.id)).toEqual([3, 2, 1])
  })

  it('lets the incoming row win without duplicating an id', () => {
    const current = [chat(1, 100)]
    const refreshed = { ...chat(1, 400), avatarUrl: 'wx-media://f/a' }
    const merged = mergeChatList(current as never, [refreshed] as never)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.avatarUrl).toBe('wx-media://f/a')
    expect(merged[0]?.lastMessageAt).toBe(400)
  })

  it('keeps loaded rows the page does not mention', () => {
    const current = [chat(5, 500), chat(6, 600)]
    const merged = mergeChatList(current as never, [chat(6, 600)] as never)
    expect(merged.map((row) => row.id)).toEqual([6, 5])
  })

  it('returns the same array for an empty page', () => {
    const current = [chat(1, 100)] as never
    expect(mergeChatList(current, [])).toBe(current)
  })
})
