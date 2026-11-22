import type { Message } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { editLabel, editTargetOf } from './editTarget'

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    chatId: 10,
    senderId: 7,
    senderName: 'Ada',
    outgoing: true,
    date: 1_700_000_000,
    kind: 'text',
    text: 'hi',
    ...overrides,
  }
}

describe('editTargetOf', () => {
  it('edits a text row through editMessageText', () => {
    expect(editTargetOf(message())).toBe('text')
  })

  it('edits the caption of every kind whose content carries one', () => {
    for (const kind of ['photo', 'video', 'file', 'voice'] as const) {
      expect(editTargetOf(message({ kind, media: { fileId: 9 } }))).toBe('caption')
    }
  })

  it('leaves the rows that this client cannot edit alone', () => {
    // TDLib calls a poll "editable" (stop it) and a sticker has an emoji, not a
    // caption: offering 编辑 there would open a composer that cannot save.
    expect(editTargetOf(message({ kind: 'poll', text: 'q' }))).toBeNull()
    expect(editTargetOf(message({ kind: 'sticker', text: '', media: { fileId: 9 } }))).toBeNull()
    expect(editTargetOf(message({ kind: 'service', text: 'x' }))).toBeNull()
    expect(editTargetOf(message({ kind: 'rich', text: 'x' }))).toBeNull()
    expect(editTargetOf(message({ kind: 'contact', text: 'x' }))).toBeNull()
    expect(editTargetOf(message({ kind: 'emoji', text: '😀' }))).toBeNull()
  })

  it('needs the media of a caption row before it offers an edit', () => {
    expect(editTargetOf(message({ kind: 'photo', text: '' }))).toBeNull()
  })
})

describe('editLabel', () => {
  it('calls a caption what WeChat calls it', () => {
    expect(editLabel('text')).toBe('编辑')
    expect(editLabel('caption')).toBe('编辑说明')
  })
})
