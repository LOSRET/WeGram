import type { Message } from '@wechatgram/protocol'
import { describe, expect, it } from 'vitest'

import { isEmojiOnly } from './emoji'
import { buildMessageMenuItems } from './menu'
import { findUnreadMessage } from './unread'

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
