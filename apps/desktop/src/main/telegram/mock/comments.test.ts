import { describe, expect, it } from 'vitest'

import { threadInteraction } from '@wegram/mock-session'

import { mockThread, pageThread } from './comments'

describe('mock comment threads', () => {
  it('builds a thread whose ids ascend and whose dates follow the post', () => {
    const thread = mockThread(2, 203, 5, 300)
    expect(thread).toHaveLength(5)
    expect(thread.map((message) => message.id)).toEqual([
      920_300, 920_301, 920_302, 920_303, 920_304,
    ])
    expect(thread[0]?.date).toBeLessThan(thread[4]?.date ?? 0)
    expect(thread[0]?.senderName).not.toBe('')
  })

  it('counts as the interaction the bar reads', () => {
    const thread = mockThread(5, 502, 78, 600)
    expect(threadInteraction(thread.length, { views: 12_400, forwards: 96 })).toEqual({
      comments: 78,
      canOpen: true,
      views: 12_400,
      forwards: 96,
    })
  })

  it('pages from the newest comments backwards, exclusive cursor', () => {
    const thread = mockThread(2, 203, 7, 300)
    const newest = pageThread(thread, { limit: 3 })
    expect(newest.messages.map((message) => message.id)).toEqual([920_304, 920_305, 920_306])
    expect(newest.hasMore).toBe(true)

    const older = pageThread(thread, { fromMessageId: 920_304, limit: 3 })
    expect(older.messages.map((message) => message.id)).toEqual([920_301, 920_302, 920_303])
    expect(older.hasMore).toBe(true)

    const first = pageThread(thread, { fromMessageId: 920_301, limit: 3 })
    expect(first.messages.map((message) => message.id)).toEqual([920_300])
    expect(first.hasMore).toBe(false)
  })

  it('answers an empty page for a message without a thread', () => {
    expect(pageThread(undefined, { limit: 3 })).toEqual({ messages: [], hasMore: false })
  })
})
