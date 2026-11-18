import type { Message, MessageOp } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import {
  EMPTY_MESSAGES,
  PENDING_OPS_LIMIT,
  appendNewerMessages,
  hasReplayableOps,
  reduceOps,
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
