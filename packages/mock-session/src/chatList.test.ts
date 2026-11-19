import { describe, expect, it } from 'vitest'

import { sortChatList } from './chatList'

const sort = (rows: { title: string; pinned: boolean; lastMessageAt?: number }[]) =>
  sortChatList(rows).map((row) => row.title)

describe('sortChatList', () => {
  it('puts pinned chats first', () => {
    expect(
      sort([
        { title: 'old', pinned: false, lastMessageAt: 10 },
        { title: 'pin', pinned: true, lastMessageAt: 1 },
      ]),
    ).toEqual(['pin', 'old'])
  })

  it('orders by newest activity inside a group', () => {
    expect(
      sort([
        { title: 'old', pinned: false, lastMessageAt: 10 },
        { title: 'new', pinned: false, lastMessageAt: 20 },
        { title: 'undated', pinned: false },
      ]),
    ).toEqual(['new', 'old', 'undated'])
  })

  it('does not mutate its input', () => {
    const rows = [
      { title: 'a', pinned: false, lastMessageAt: 1 },
      { title: 'b', pinned: false, lastMessageAt: 2 },
    ]
    sortChatList(rows)
    expect(rows.map((row) => row.title)).toEqual(['a', 'b'])
  })
})
