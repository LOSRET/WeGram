import { describe, expect, it } from 'vitest'

import { CHAT_LOAD_AHEAD, nearListEnd } from './chatPaging'

describe('nearListEnd (会话列表分页)', () => {
  it('stays quiet until the window is within the margin of the end', () => {
    expect(nearListEnd(10, 200)).toBe(false)
    expect(nearListEnd(200 - CHAT_LOAD_AHEAD - 1, 200)).toBe(false)
  })

  it('fires inside the margin and at the bottom', () => {
    expect(nearListEnd(200 - CHAT_LOAD_AHEAD, 200)).toBe(true)
    expect(nearListEnd(199, 200)).toBe(true)
  })

  it('never pages an empty list or one with no mounted row', () => {
    expect(nearListEnd(0, 0)).toBe(false)
    expect(nearListEnd(-1, 50)).toBe(false)
  })
})
