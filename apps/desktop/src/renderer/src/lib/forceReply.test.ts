import type { Message } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { activeForceReply } from './forceReply'

function message(id: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    chatId: 13,
    senderId: 26,
    senderName: 'WeGram 助手',
    outgoing: false,
    date: 100 + id,
    kind: 'text',
    text: String(id),
    ...extra,
  }
}

describe('activeForceReply', () => {
  it('offers the row that asked to be answered directly', () => {
    expect(activeForceReply([message(1), message(2, { forceReply: {} })])).toEqual({
      messageId: 2,
    })
  })

  it('carries the placeholder the bot named', () => {
    expect(
      activeForceReply([message(1, { forceReply: { placeholder: '请回答这个问题' } })]),
    ).toEqual({ messageId: 1, placeholder: '请回答这个问题' })
  })

  it('is done once the reader has answered', () => {
    // The answer is an outgoing row newer than the marker: the banner belongs to
    // a prompt that no longer waits for anything.
    expect(
      activeForceReply([message(1, { forceReply: {} }), message(2, { outgoing: true })]),
    ).toBeNull()
  })

  it('keeps waiting after an unrelated incoming message', () => {
    expect(activeForceReply([message(1, { forceReply: {} }), message(2), message(3)])).toEqual({
      messageId: 1,
    })
  })

  it('has nothing pending without a marker', () => {
    expect(activeForceReply([])).toBeNull()
    expect(activeForceReply([message(1), message(2)])).toBeNull()
  })
})
