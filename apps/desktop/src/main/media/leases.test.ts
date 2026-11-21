import { describe, expect, it } from 'vitest'

import { drop, hold } from './leases'

describe('download leases', () => {
  it('answers true only for the holder that leaves last', () => {
    hold(7, 'bubble')
    hold(7, 'viewer')
    expect(drop(7, 'bubble')).toBe(false)
    expect(drop(7, 'viewer')).toBe(true)
  })

  it('never reports a cancel for an owner that already released', () => {
    hold(8, 'bubble')
    expect(drop(8, 'bubble')).toBe(true)
    expect(drop(8, 'bubble')).toBe(false)
  })

  it('keeps files apart', () => {
    hold(9, 'a')
    hold(10, 'b')
    expect(drop(9, 'a')).toBe(true)
    expect(drop(10, 'b')).toBe(true)
  })
})
