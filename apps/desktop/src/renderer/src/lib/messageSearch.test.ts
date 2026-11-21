import type { ChatSummary, Message } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { cursorHasMore, hitKey, mergeHits, pageHits } from './messageSearch'

function chat(id: number, title: string): ChatSummary {
  return { id, title, kind: 'group', unread: 0, pinned: false, muted: false }
}

function message(id: number, chatId: number, text: string, date = 100): Message {
  return { id, chatId, senderId: 1, senderName: '对方', outgoing: false, date, kind: 'text', text }
}

describe('pageHits', () => {
  it('joins each message to the summary of its chat', () => {
    const front = chat(2, '前端周会')
    const hits = pageHits([message(10, 2, '会议纪要'), message(11, 2, '下周见')], [front])
    expect(hits).toEqual([
      { message: message(10, 2, '会议纪要'), chat: front },
      { message: message(11, 2, '下周见'), chat: front },
    ])
    expect(hits.map(hitKey)).toEqual(['2:10', '2:11'])
  })

  it('drops a message whose chat summary is missing', () => {
    expect(pageHits([message(10, 7, '孤儿')], [chat(2, '前端周会')])).toEqual([])
  })
})

describe('mergeHits', () => {
  it('appends a page and keeps the rows already shown', () => {
    const first = { message: message(10, 2, 'a', 300), chat: chat(2, '前端周会') }
    const second = { message: message(9, 2, 'b', 200), chat: chat(2, '前端周会') }
    expect(mergeHits([first], [second])).toEqual([first, second])
  })

  it('drops a duplicate row instead of drawing it twice', () => {
    const hit = { message: message(10, 2, 'a'), chat: chat(2, '前端周会') }
    expect(mergeHits([hit], [hit])).toEqual([hit])
  })
})

describe('cursorHasMore', () => {
  it('is false before the first answer and once every stream is exhausted', () => {
    expect(cursorHasMore(null)).toBe(false)
    expect(cursorHasMore({ private: '', group: '', channel: '' })).toBe(false)
  })

  it('is true while one stream still has a page', () => {
    expect(cursorHasMore({ private: 'abc', group: '', channel: '' })).toBe(true)
    expect(cursorHasMore({ private: '', group: '', channel: 'xyz' })).toBe(true)
  })
})
