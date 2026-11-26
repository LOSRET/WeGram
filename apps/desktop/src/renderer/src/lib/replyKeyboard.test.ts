import type { Message, ReplyKeyboard } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { activeReplyKeyboard } from './replyKeyboard'

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

const KEYBOARD: ReplyKeyboard = {
  rows: [[{ text: '今日推荐', sendsText: true }]],
}

describe('activeReplyKeyboard', () => {
  it('takes the newest message that carries a keyboard', () => {
    expect(
      activeReplyKeyboard([
        message(1, { replyKeyboard: KEYBOARD }),
        message(2),
        message(3, { replyKeyboard: KEYBOARD }),
      ]),
    ).toEqual({ messageId: 3, senderId: 26, keyboard: KEYBOARD })
  })

  it('keeps the last keyboard when later messages carry none', () => {
    // Telegram's rule: an ordinary reply does not clear the grid, so the older
    // keyboard stays the chat's until a newer one replaces it.
    expect(
      activeReplyKeyboard([message(1, { replyKeyboard: KEYBOARD }), message(2), message(3)]),
    ).toEqual({ messageId: 1, senderId: 26, keyboard: KEYBOARD })
  })

  it('has no keyboard for a chat that never got one', () => {
    expect(activeReplyKeyboard([])).toBeNull()
    expect(activeReplyKeyboard([message(1), message(2)])).toBeNull()
  })

  it('skips a malformed keyboard instead of drawing an empty grid', () => {
    expect(
      activeReplyKeyboard([
        message(1, { replyKeyboard: KEYBOARD }),
        message(2, { replyKeyboard: { rows: [] } }),
      ]),
    ).toEqual({
      messageId: 1,
      senderId: 26,
      keyboard: KEYBOARD,
    })
  })

  it('drops the grid when the bot removed its keyboard', () => {
    // `replyMarkupRemoveKeyboard` is the newest word on the subject even though the
    // removal row carries no keyboard of its own; the older grid must not linger.
    expect(
      activeReplyKeyboard([
        message(1, { replyKeyboard: KEYBOARD }),
        message(2, { replyKeyboardHidden: true }),
      ]),
    ).toBeNull()
  })

  it('shows a newer keyboard again after a removal', () => {
    expect(
      activeReplyKeyboard([
        message(1, { replyKeyboard: KEYBOARD }),
        message(2, { replyKeyboardHidden: true }),
        message(3, { replyKeyboard: KEYBOARD }),
      ]),
    ).toEqual({ messageId: 3, senderId: 26, keyboard: KEYBOARD })
  })
})
