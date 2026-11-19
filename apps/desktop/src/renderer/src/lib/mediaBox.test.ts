import { describe, expect, it } from 'vitest'

import { percentOf, reserveBox } from './mediaBox'

const LIMITS = { maxWidth: 240, maxHeight: 300, fallbackWidth: 4, fallbackHeight: 3 }

describe('reserveBox', () => {
  it('scales a landscape photo into the width limit', () => {
    expect(reserveBox({ width: 800, height: 400 }, LIMITS)).toEqual({ width: 240, height: 120 })
  })

  it('scales a portrait photo into the height limit', () => {
    expect(reserveBox({ width: 300, height: 600 }, LIMITS)).toEqual({ width: 150, height: 300 })
  })

  it('never upscales beyond the limits', () => {
    expect(reserveBox({ width: 10, height: 10 }, LIMITS)).toEqual({ width: 240, height: 240 })
  })

  it('falls back to the caller ratio without dimensions', () => {
    expect(reserveBox({}, { ...LIMITS, fallbackWidth: 16, fallbackHeight: 9 })).toEqual({
      width: 240,
      height: 135,
    })
  })
})

describe('percentOf', () => {
  it('rounds to whole percent', () => {
    expect(percentOf(0)).toBe('0%')
    expect(percentOf(0.126)).toBe('13%')
    expect(percentOf(1)).toBe('100%')
  })
})
