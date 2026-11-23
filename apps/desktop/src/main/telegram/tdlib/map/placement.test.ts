import { describe, expect, it } from 'vitest'

import { chatPlacement } from './placement'

const position = (list: 'chatListMain' | 'chatListArchive', pinned = false, order = 10) => ({
  _: 'chatPosition',
  list: { _: list },
  order: String(order),
  is_pinned: pinned,
})

function chat(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chat_lists: [{ _: 'chatListMain' }],
    positions: [position('chatListMain')],
    ...overrides,
  }
}

describe('chatPlacement', () => {
  it('reads a main-list chat and its pinned flag', () => {
    expect(chatPlacement(chat({ positions: [position('chatListMain', true)] }))).toEqual({
      archived: false,
      pinned: true,
    })
  })

  it('reads the archive from chat_lists, not from a position', () => {
    expect(
      chatPlacement(
        chat({
          chat_lists: [{ _: 'chatListArchive' }],
          positions: [position('chatListArchive', true)],
        }),
      ),
    ).toEqual({ archived: true, pinned: true })
  })

  it('ignores an order-0 position: that means "removed from the list"', () => {
    expect(chatPlacement(chat({ positions: [position('chatListMain', true, 0)] }))).toEqual({
      archived: false,
      pinned: false,
    })
  })

  it('does not take the pinned flag from the other list\'s position', () => {
    expect(
      chatPlacement(
        chat({
          chat_lists: [{ _: 'chatListArchive' }],
          positions: [position('chatListMain', true), position('chatListArchive')],
        }),
      ),
    ).toEqual({ archived: true, pinned: false })
  })

  it('treats a chat without positions as unpinned', () => {
    expect(chatPlacement(chat({ positions: [] }))).toEqual({ archived: false, pinned: false })
  })
})
