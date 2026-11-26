import { describe, expect, it } from 'vitest'

import { moveActiveOption } from './selectKey'

describe('moveActiveOption', () => {
  it('walks down and up one row', () => {
    expect(moveActiveOption(1, 4, 'ArrowDown')).toBe(2)
    expect(moveActiveOption(1, 4, 'ArrowUp')).toBe(0)
  })

  it('wraps at both ends, like the client', () => {
    expect(moveActiveOption(3, 4, 'ArrowDown')).toBe(0)
    expect(moveActiveOption(0, 4, 'ArrowUp')).toBe(3)
  })

  it('jumps to the ends with Home and End', () => {
    expect(moveActiveOption(2, 5, 'Home')).toBe(0)
    expect(moveActiveOption(2, 5, 'End')).toBe(4)
  })

  it('clamps a stale index and stays at 0 for an empty list', () => {
    expect(moveActiveOption(9, 3, 'ArrowUp')).toBe(1)
    expect(moveActiveOption(-2, 3, 'ArrowDown')).toBe(1)
    expect(moveActiveOption(4, 0, 'ArrowDown')).toBe(0)
  })
})
