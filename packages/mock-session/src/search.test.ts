import { describe, expect, it } from 'vitest'

import { searchChatRows, searchMessageRows, searchMessagesInScope } from './search'

const chat = (id: number, title: string, kind = 'group') => ({ id, title, kind })
const message = (id: number, date: number, text: string) => ({ id, date, text })

describe('searchChatRows', () => {
  it('matches a title case-insensitively and trims the box', () => {
    const chats = [chat(1, 'WeGram 开发组'), chat(2, '前端周会')]
    expect(searchChatRows(chats, '  wegram ', 10).map((row) => row.id)).toEqual([1])
    expect(searchChatRows(chats, '周', 10).map((row) => row.id)).toEqual([2])
  })

  it('answers nothing for an empty box, and honours the limit', () => {
    const chats = [chat(1, 'a'), chat(2, 'ab'), chat(3, 'abc')]
    expect(searchChatRows(chats, '   ', 10)).toEqual([])
    expect(searchChatRows(chats, 'a', 2).map((row) => row.id)).toEqual([1, 2])
  })
})

describe('searchMessageRows', () => {
  it('finds a substring case-insensitively and skips an empty box', () => {
    const rows = [message(1, 1, 'Release notes'), message(2, 2, '周会纪要')]
    expect(searchMessageRows(rows, 'release').map((row) => row.id)).toEqual([1])
    expect(searchMessageRows(rows, '')).toEqual([])
  })
})

describe('searchMessagesInScope', () => {
  const entries = [
    {
      chat: chat(1, '群', 'group'),
      messages: [message(10, 100, '发布 v0.3'), message(11, 300, '发布 v0.4')],
    },
    { chat: chat(2, '频道', 'channel'), messages: [message(20, 200, '发布公告')] },
  ]

  it('merges the rows of one scope newest-first and reports the total', () => {
    const page = searchMessagesInScope(entries, { q: '发布', scope: 'chat', limit: 10 })
    expect(page.messages.map((row) => row.id)).toEqual([11, 10])
    expect(page.total).toBe(2)
    expect(page.chats.map((row) => row.id)).toEqual([1])
    expect(page.cursor).toEqual({ private: '', group: '', channel: '' })
  })

  it('keeps the channel hits on their own tab', () => {
    const page = searchMessagesInScope(entries, { q: '发布', scope: 'channel', limit: 10 })
    expect(page.messages.map((row) => row.id)).toEqual([20])
  })

  it('hands the next offset back in the cursor of that scope', () => {
    const first = searchMessagesInScope(entries, { q: '发布', scope: 'chat', limit: 1 })
    expect(first.cursor.private).toBe('1')
    const second = searchMessagesInScope(entries, {
      q: '发布',
      scope: 'chat',
      limit: 1,
      cursor: first.cursor,
    })
    expect(second.messages.map((row) => row.id)).toEqual([10])
    expect(second.cursor.private).toBe('')
  })

  it('copies the chat rows it returns', () => {
    const page = searchMessagesInScope(entries, { q: '发布', scope: 'chat', limit: 10 })
    const row = page.chats[0]
    if (!row) throw new Error('no chat row')
    row.title = 'changed'
    expect(entries[0]?.chat.title).toBe('群')
  })
})
