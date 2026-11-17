import { describe, expect, it } from 'vitest'

import { classifySeq, needsResync } from './eventSeq'

describe('classifySeq', () => {
  it('accepts the first event of a stream without asking questions', () => {
    expect(classifySeq(null, 1)).toBe('first')
    expect(classifySeq(null, 4711)).toBe('first')
  })

  it('follows a contiguous stream', () => {
    expect(classifySeq(1, 2)).toBe('next')
    expect(classifySeq(99, 100)).toBe('next')
  })

  it('treats a repeated envelope as a duplicate, not a hole', () => {
    expect(classifySeq(7, 7)).toBe('duplicate')
    expect(needsResync('duplicate')).toBe(false)
  })

  it('reports the size of the hole only as "gap"', () => {
    expect(classifySeq(7, 9)).toBe('gap')
    expect(classifySeq(7, 900)).toBe('gap')
    expect(needsResync('gap')).toBe(true)
  })

  it('reads a backwards counter as a rebuilt stream, not as a duplicate', () => {
    // A re-login restarts the counter: the old baseline would otherwise swallow every
    // later event as "stale" and the gap detector would go blind for the session.
    expect(classifySeq(500, 1)).toBe('restart')
    expect(needsResync('restart')).toBe(true)
  })

  it('does not treat the two non-sequential verdicts as resync triggers', () => {
    expect(needsResync('first')).toBe(false)
    expect(needsResync('next')).toBe(false)
  })
})
