import type { Message } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { findRowIndex, groupMessages } from './rows'

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    chatId: 1,
    senderId: 2000,
    senderName: '对方',
    outgoing: false,
    date: 1_700_000_000,
    kind: 'photo',
    text: '',
    media: { fileId: id },
    ...overrides,
  }
}

/** One item of album 900. */
function item(id: number, overrides: Partial<Message> = {}): Message {
  return message(id, { albumId: '900', ...overrides })
}

const shape = (messages: Message[]): number[][] =>
  groupMessages(messages).map((row) => row.messages.map((message) => message.id))

describe('groupMessages', () => {
  it('folds consecutive items of one album into a single row', () => {
    expect(shape([message(1), item(2), item(3), message(4)])).toEqual([[1], [2, 3], [4]])
  })

  it('accepts a mixed photo/video album', () => {
    expect(shape([item(2, { kind: 'video' }), item(3)])).toEqual([[2, 3]])
  })

  it('keeps two albums apart even when they touch', () => {
    const second = [item(4, { albumId: '901' }), item(5, { albumId: '901' })]
    expect(shape([item(2), item(3), ...second])).toEqual([
      [2, 3],
      [4, 5],
    ])
  })

  it('does not merge through a message that sits between the items', () => {
    expect(shape([item(2), message(3, { kind: 'text' }), item(4)])).toEqual([[2], [3], [4]])
  })

  it('does not merge items from different senders', () => {
    expect(shape([item(2), item(3, { senderId: 2001 })])).toEqual([[2], [3]])
  })

  it('leaves a lone album item as a plain row', () => {
    const rows = groupMessages([item(7)])
    expect(rows).toHaveLength(1)
    // Named after its album, so the key does not move when a sibling arrives.
    expect(rows[0]?.key).toBe('a:900')
  })

  it('hooks the row key to the album, so a prepend cannot rename it', () => {
    const before = groupMessages([item(2), item(3)])[0]?.key
    const after = groupMessages([item(1), item(2), item(3)])[0]?.key
    expect(before).toBe('a:900')
    expect(after).toBe('a:900')
  })

  it('keys a single message and an album differently', () => {
    expect(groupMessages([message(1), item(2), item(3)]).map((row) => row.key)).toEqual([
      'm:1',
      'a:900',
    ])
  })
})

describe('findRowIndex', () => {
  it('finds the row that owns an album item, not just its first item', () => {
    const rows = groupMessages([message(1), item(2), item(3), message(4)])
    expect(findRowIndex(rows, 2)).toBe(1)
    expect(findRowIndex(rows, 3)).toBe(1)
    expect(findRowIndex(rows, 4)).toBe(2)
    expect(findRowIndex(rows, 99)).toBe(-1)
  })
})
