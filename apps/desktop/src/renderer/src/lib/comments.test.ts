import type { Message } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import {
  commentBarLabel,
  commentKey,
  formatCount,
  hasCommentBar,
  isCommentablePost,
  mergeComments,
  mergeNewestPage,
} from './comments'

function comment(id: number, text = `c${id}`): Message {
  return {
    id,
    chatId: 2,
    senderId: 4100 + id,
    senderName: `author-${id}`,
    outgoing: false,
    date: 1_700_000_000 + id,
    kind: 'text',
    text,
  }
}

describe('comment bar rules', () => {
  it('keys a thread by chat and message', () => {
    expect(commentKey(2, 203)).toBe('2:203')
    expect(commentKey(2, 203)).not.toBe(commentKey(3, 203))
  })

  it('draws the bar for a count and for a thread that has none yet', () => {
    expect(hasCommentBar(undefined)).toBe(false)
    expect(hasCommentBar({ comments: 0 })).toBe(false)
    expect(hasCommentBar({ comments: 0, canOpen: true })).toBe(true)
    expect(hasCommentBar({ comments: 1, canOpen: true })).toBe(true)
  })

  it('draws the bar on a channel post, never on a group or private message', () => {
    expect(isCommentablePost({ kind: 'channel' })).toBe(true)
    // TDLib reports reply_info for these too; no official client draws the handle,
    // and the thread they name cannot be opened from the group.
    expect(isCommentablePost({ kind: 'group' })).toBe(false)
    expect(isCommentablePost({ kind: 'private' })).toBe(false)
  })

  it('labels an unused thread as 写评论 and a used one with its count', () => {
    expect(commentBarLabel({ comments: 0, canOpen: true })).toBe('写评论')
    expect(commentBarLabel({ comments: 12 })).toBe('评论 12 条')
    expect(commentBarLabel({ comments: 12_400 })).toBe('评论 1.2万 条')
  })

  it('prepends an older page and keeps the thread ascending', () => {
    const current = [comment(21), comment(22)]
    expect(mergeComments(current, [comment(11), comment(12)]).map((m) => m.id)).toEqual([
      11, 12, 21, 22,
    ])
  })

  it('drops duplicates and anything newer than the first row', () => {
    const current = [comment(21), comment(22)]
    const merged = mergeComments(current, [comment(21), comment(23), comment(11)])
    expect(merged.map((message) => message.id)).toEqual([11, 21, 22])
  })

  it('keeps the same array when a page adds nothing', () => {
    const current = [comment(21)]
    expect(mergeComments(current, [comment(22)])).toBe(current)
    expect(mergeComments(current, [])).toBe(current)
  })
})

describe('mergeNewestPage', () => {
  it('extends a cached window with comments posted since the last visit', () => {
    const cached = { messages: [comment(10), comment(11)], hasMore: true }
    const next = mergeNewestPage(cached, [comment(11), comment(12), comment(13)], false)

    expect(next?.messages.map((message) => message.id)).toEqual([10, 11, 12, 13])
    // The older direction did not change: the cached flag still answers it.
    expect(next?.hasMore).toBe(true)
  })

  it('takes a fresh copy of a row the server has changed', () => {
    const cached = { messages: [comment(10, 'old')], hasMore: false }
    const next = mergeNewestPage(cached, [comment(10, 'edited')], true)

    expect(next?.messages[0]?.text).toBe('edited')
  })

  it('replaces a window the newest page no longer touches', () => {
    // A whole page of comments arrived between two opens: joining the two windows
    // would hide the gap, so the server page wins and older comments page back.
    const cached = { messages: [comment(10)], hasMore: false }
    const next = mergeNewestPage(cached, [comment(41), comment(42)], true)

    expect(next?.messages.map((message) => message.id)).toEqual([41, 42])
    expect(next?.hasMore).toBe(true)
  })

  it('starts from the answer when the panel began with no rows', () => {
    const next = mergeNewestPage({ messages: [], hasMore: false }, [comment(1)], false)
    expect(next?.messages.map((message) => message.id)).toEqual([1])
    expect(next?.hasMore).toBe(false)
  })

  it('has nothing to do for an empty answer', () => {
    expect(mergeNewestPage({ messages: [comment(1)], hasMore: false }, [], false)).toBeNull()
  })
})

describe('formatCount', () => {
  it('shows exact numbers below 10 000', () => {
    expect(formatCount(96)).toBe('96')
    expect(formatCount(0)).toBe('0')
  })

  it('compacts into 万 and 亿 like the client', () => {
    expect(formatCount(10_000)).toBe('1万')
    expect(formatCount(12_400)).toBe('1.2万')
    expect(formatCount(123_456_789)).toBe('1.2亿')
  })
})
