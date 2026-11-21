import { describe, expect, it } from 'vitest'

import { pickVariant } from './mediaVariant'

const SIZES = [
  { fileId: 1, width: 90, height: 90 },
  { fileId: 2, width: 320, height: 320 },
  { fileId: 3, width: 800, height: 800 },
  { fileId: 4, width: 1280, height: 1280 },
]

describe('pickVariant', () => {
  it('picks the smallest variant that covers the box', () => {
    expect(pickVariant(SIZES, { width: 240, height: 180 })?.fileId).toBe(2)
    expect(pickVariant(SIZES, { width: 480, height: 480 })?.fileId).toBe(3)
    expect(pickVariant(SIZES, { width: 1, height: 1 })?.fileId).toBe(1)
  })

  it('falls back to the largest variant when nothing is big enough', () => {
    expect(pickVariant(SIZES, { width: 4000, height: 3000 })?.fileId).toBe(4)
  })

  it('has no answer without a size table', () => {
    expect(pickVariant(undefined, { width: 240, height: 180 })).toBeUndefined()
    expect(pickVariant([], { width: 240, height: 180 })).toBeUndefined()
  })

  it('covers both sides, not just the width', () => {
    const wide = [
      { fileId: 5, width: 600, height: 200 },
      { fileId: 6, width: 320, height: 320 },
    ]
    expect(pickVariant(wide, { width: 300, height: 300 })?.fileId).toBe(6)
  })
})
