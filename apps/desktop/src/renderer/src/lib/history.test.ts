import { describe, expect, it } from 'vitest'

import { emptyPageIsHistory } from './history'

const message = { id: 1 } as Parameters<typeof emptyPageIsHistory>[0]['messages'][number]

/**
 * Regression guard for "the chat opened blank until 重新加载": an empty page must only
 * be believed for a chat that has no last message (see the module comment).
 */
describe('emptyPageIsHistory', () => {
  it('believes an empty page for a chat without a last message', () => {
    expect(emptyPageIsHistory({ messages: [] }, {})).toBe(true)
    expect(emptyPageIsHistory({ messages: [] }, undefined)).toBe(true)
  })

  it('refuses an empty page for a chat the chat list says has messages', () => {
    expect(emptyPageIsHistory({ messages: [] }, { lastMessageAt: 1_700_000_000 })).toBe(false)
  })

  it('never claims a non-empty page is empty', () => {
    expect(emptyPageIsHistory({ messages: [message] }, {})).toBe(false)
    expect(emptyPageIsHistory({ messages: [message] }, { lastMessageAt: 1_700_000_000 })).toBe(
      false,
    )
  })
})
