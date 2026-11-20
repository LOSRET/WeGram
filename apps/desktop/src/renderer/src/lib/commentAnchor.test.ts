import { describe, expect, it } from 'vitest'

import { resolveCommentLanding } from './commentAnchor'

const rows = [{ id: 11 }, { id: 12 }, { id: 13 }]

describe('the comment thread landing rule', () => {
  it('opens at the top when the reader never scrolled', () => {
    expect(resolveCommentLanding(rows, null)).toBeNull()
  })

  it('restores the stored row and its offset', () => {
    const anchor = { messageId: 12, offset: -40 }
    expect(resolveCommentLanding(rows, anchor)).toBe(anchor)
  })

  it('falls back to the top when the stored row is outside the loaded window', () => {
    expect(resolveCommentLanding(rows, { messageId: 3, offset: 0 })).toBeNull()
    expect(resolveCommentLanding([], { messageId: 11, offset: 0 })).toBeNull()
  })
})
