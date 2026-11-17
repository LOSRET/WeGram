import { describe, expect, it } from 'vitest'

import { mayMarkRead } from './readGate'

describe('mayMarkRead', () => {
  const seen = { seenUpToMessageId: 12, visible: true, focused: true }

  it('marks read for the newest message that has been on screen', () => {
    expect(mayMarkRead(seen)).toBe(true)
  })

  it('reports nothing before a single row has been measured', () => {
    expect(mayMarkRead({ ...seen, seenUpToMessageId: null })).toBe(false)
  })

  it('never marks read for a hidden or unfocused window', () => {
    expect(mayMarkRead({ ...seen, visible: false })).toBe(false)
    expect(mayMarkRead({ ...seen, focused: false })).toBe(false)
    expect(mayMarkRead({ seenUpToMessageId: null, visible: false, focused: false })).toBe(false)
  })
})
