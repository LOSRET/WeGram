import type { Message } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { isEmojiOnly } from './emoji'
import { buildMessageMenuItems } from './menu'
import { countUnreadBelow } from './unreadBelow'
import { findUnreadMessage, pickPagingTarget, resolveLanding } from './unread'

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    chatId: 1,
    senderId: 2000,
    senderName: '对方',
    outgoing: false,
    date: 1_700_000_000,
    kind: 'text',
    text: `m${id}`,
    ...overrides,
  }
}

const messages = [message(10), message(11), message(12), message(13)]

describe('findUnreadMessage', () => {
  it('returns null without a marker, without unread messages or without a transcript', () => {
    expect(findUnreadMessage(messages, null)).toBeNull()
    expect(findUnreadMessage(messages, { lastReadInboxMessageId: 10, unread: 0 })).toBeNull()
    expect(findUnreadMessage([], { lastReadInboxMessageId: 10, unread: 3 })).toBeNull()
  })

  it('lands on the first incoming message after the read marker', () => {
    expect(findUnreadMessage(messages, { lastReadInboxMessageId: 11, unread: 2 })).toBe(12)
  })

  it('skips our own outgoing messages when looking for the divider', () => {
    const withOwn = [message(10), message(11, { outgoing: true }), message(12)]
    expect(findUnreadMessage(withOwn, { lastReadInboxMessageId: 10, unread: 2 })).toBe(12)
  })

  it('falls back to the unread counter when the marker is missing', () => {
    expect(findUnreadMessage(messages, { lastReadInboxMessageId: null, unread: 2 })).toBe(12)
  })

  it('clamps a counter larger than the transcript to the first message', () => {
    expect(findUnreadMessage(messages, { lastReadInboxMessageId: null, unread: 99 })).toBe(10)
  })

  it('returns null when everything after the marker is ours', () => {
    const own = [message(10), message(11, { outgoing: true })]
    expect(findUnreadMessage(own, { lastReadInboxMessageId: 10, unread: 1 })).toBeNull()
  })
})

describe('resolveLanding', () => {
  const saved = { messageId: 13, offset: 24 }

  it('lands on the newest message when there is neither a position nor unread mail', () => {
    expect(resolveLanding(messages, null, null)).toBeNull()
    expect(resolveLanding(messages, { lastReadInboxMessageId: 10, unread: 0 }, null)).toBeNull()
  })

  it('restores the saved position when the chat has no unread messages', () => {
    expect(resolveLanding(messages, null, saved)).toEqual({
      kind: 'anchor',
      messageId: 13,
      offset: 24,
    })
  })

  it('keeps a saved position that is at or after the read boundary', () => {
    expect(resolveLanding(messages, { lastReadInboxMessageId: 11, unread: 2 }, saved)).toEqual({
      kind: 'anchor',
      messageId: 13,
      offset: 24,
    })
  })

  it('prefers the unread divider over a position in the already-read history', () => {
    expect(
      resolveLanding(
        messages,
        { lastReadInboxMessageId: 11, unread: 2 },
        {
          messageId: 10,
          offset: 0,
        },
      ),
    ).toEqual({ kind: 'unread', messageId: 12 })
  })

  it('ignores a saved position that is not in the loaded window', () => {
    expect(
      resolveLanding(
        messages,
        { lastReadInboxMessageId: 11, unread: 2 },
        {
          messageId: 99,
          offset: 0,
        },
      ),
    ).toEqual({ kind: 'unread', messageId: 12 })
    expect(resolveLanding(messages, null, { messageId: 99, offset: 0 })).toBeNull()
  })

  it('falls back to the unread counter when the boundary is unknown', () => {
    // No read marker means the divider wins over the saved position.
    expect(resolveLanding(messages, { lastReadInboxMessageId: null, unread: 2 }, saved)).toEqual({
      kind: 'unread',
      messageId: 12,
    })
  })
})

describe('pickPagingTarget', () => {
  it('pages back to the read boundary when the chat has unread messages', () => {
    expect(pickPagingTarget(null, { lastReadInboxMessageId: 11, unread: 2 })).toEqual({
      kind: 'unread',
      messageId: 11,
    })
    expect(pickPagingTarget({ messageId: 10 }, { lastReadInboxMessageId: 11, unread: 2 })).toEqual({
      kind: 'unread',
      messageId: 11,
    })
  })

  it('pages back to the saved position when it is after the read boundary', () => {
    expect(pickPagingTarget({ messageId: 13 }, { lastReadInboxMessageId: 11, unread: 2 })).toEqual({
      kind: 'anchor',
      messageId: 13,
    })
  })

  it('pages back to the saved position when nothing is unread', () => {
    expect(pickPagingTarget({ messageId: 13 }, null)).toEqual({ kind: 'anchor', messageId: 13 })
    expect(pickPagingTarget({ messageId: 13 }, { lastReadInboxMessageId: 11, unread: 0 })).toEqual({
      kind: 'anchor',
      messageId: 13,
    })
  })

  it('cannot page for the counter fallback, so a position still wins', () => {
    expect(
      pickPagingTarget({ messageId: 13 }, { lastReadInboxMessageId: null, unread: 2 }),
    ).toEqual({ kind: 'anchor', messageId: 13 })
  })

  it('has nothing to page for without a position or unread messages', () => {
    expect(pickPagingTarget(null, null)).toBeNull()
    expect(pickPagingTarget(null, { lastReadInboxMessageId: 11, unread: 0 })).toBeNull()
  })
})

describe('buildMessageMenuItems', () => {
  const handlers = {
    onReply: () => undefined,
    onCopy: () => undefined,
    onForward: () => undefined,
    onEdit: () => undefined,
    onDelete: () => undefined,
  }
  const labels = (message: Message): string[] =>
    buildMessageMenuItems(message, handlers).map((item) => item.label)

  it('offers reply, copy, forward and delete on a text message', () => {
    expect(labels(message(1))).toEqual(['回复', '复制', '转发', '删除'])
  })

  it('hides copy when there is no text', () => {
    expect(labels(message(1, { kind: 'photo', text: '', media: { fileId: 1 } }))).toEqual([
      '回复',
      '转发',
      '删除',
    ])
  })

  it('only offers edit on our own plain text messages', () => {
    expect(labels(message(1, { outgoing: true }))).toContain('编辑')
    // A caption cannot be edited through this menu.
    expect(
      labels(message(1, { outgoing: true, kind: 'photo', media: { fileId: 1 } })),
    ).not.toContain('编辑')
    expect(labels(message(1, { outgoing: false }))).not.toContain('编辑')
  })

  it('marks delete as the dangerous item', () => {
    const remove = buildMessageMenuItems(message(1), handlers).find((item) => item.label === '删除')
    expect(remove?.danger).toBe(true)
  })

  it('calls the handler with the message it was built for', () => {
    const target = message(7)
    const seen: Message[] = []
    const items = buildMessageMenuItems(target, {
      ...handlers,
      onReply: (item) => seen.push(item),
    })
    items[0]?.onSelect()
    expect(seen).toEqual([target])
  })
})

describe('isEmojiOnly', () => {
  it('accepts a single emoji and an emoji-only run', () => {
    expect(isEmojiOnly('😀')).toBe(true)
    expect(isEmojiOnly('  😀😂🎉 ')).toBe(true)
    // Skin tone + ZWJ sequence.
    expect(isEmojiOnly('👍🏽')).toBe(true)
    expect(isEmojiOnly('👨‍👩‍👧')).toBe(true)
  })

  it('rejects plain text, digits and mixed content', () => {
    expect(isEmojiOnly('')).toBe(false)
    expect(isEmojiOnly('   ')).toBe(false)
    expect(isEmojiOnly('123')).toBe(false)
    expect(isEmojiOnly('ok 😀')).toBe(false)
    expect(isEmojiOnly('😀 😀 😀 😀 😀 😀 😀')).toBe(false) // longer than the cap
  })
})

describe('countUnreadBelow', () => {
  const incoming = (id: number) => ({ id, outgoing: false })
  const outgoing = (id: number) => ({ id, outgoing: true })
  const transcript = [incoming(10), incoming(11), incoming(12), incoming(13)]

  it('counts what is newer than the marker and still below the fold', () => {
    // Marker at 11, reader looking at row 12: only 13 is left below.
    expect(countUnreadBelow(transcript, 11, 2)).toBe(1)
    expect(countUnreadBelow(transcript, 11, 1)).toBe(2)
  })

  it('is zero once the read marker reached the end', () => {
    expect(countUnreadBelow(transcript, 13, -1)).toBe(0)
    // ...or once the reader scrolled past everything.
    expect(countUnreadBelow(transcript, 11, 3)).toBe(0)
  })

  it('treats an unknown marker as "nothing is read yet"', () => {
    expect(countUnreadBelow(transcript, null, 1)).toBe(2)
    expect(countUnreadBelow(transcript, null, -1)).toBe(4)
  })

  it('ignores our own messages, like the unread badge does', () => {
    const mixed = [incoming(10), outgoing(11), incoming(12)]
    expect(countUnreadBelow(mixed, 10, -1)).toBe(1)
  })

  it('never counts messages above the viewport, however new the marker is behind', () => {
    // Scrolled down over 10 and 11 without reporting them: they are seen already.
    expect(countUnreadBelow(transcript, 9, 1)).toBe(2)
  })
})
