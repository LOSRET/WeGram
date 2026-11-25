import { describe, expect, it } from 'vitest'

import { cacheShare, formatStorageSize, sumBucketSizes } from './storage'

describe('cacheShare', () => {
  it('rounds a row to its whole percent of the clearable total', () => {
    expect(cacheShare(309.4, 536.8)).toBe(58)
    expect(cacheShare(146.9, 536.8)).toBe(27)
    expect(cacheShare(79.9, 536.8)).toBe(15)
  })

  it('answers 0 for an empty row or an empty cache, and clamps the edges', () => {
    expect(cacheShare(0, 100)).toBe(0)
    expect(cacheShare(10, 0)).toBe(0)
    expect(cacheShare(-5, 100)).toBe(0)
    expect(cacheShare(100, 100)).toBe(100)
    expect(cacheShare(200, 100)).toBe(100)
  })
})

describe('formatStorageSize', () => {
  it('writes cache sizes with one decimal, like the official dialog', () => {
    expect(formatStorageSize(324_429_414)).toBe('309.4 MB')
    expect(formatStorageSize(154_035_046)).toBe('146.9 MB')
    expect(formatStorageSize(524_288)).toBe('512 KB')
    expect(formatStorageSize(100_663_296)).toBe('96 MB')
    expect(formatStorageSize(562_769_202)).toBe('536.7 MB')
  })

  it('keeps bytes whole and shows an empty cache as 0 B', () => {
    expect(formatStorageSize(0)).toBe('0 B')
    expect(formatStorageSize(512)).toBe('512 B')
    expect(formatStorageSize(-1)).toBe('0 B')
  })
})

describe('sumBucketSizes', () => {
  it('adds the ticked rows and ignores a negative size', () => {
    expect(
      sumBucketSizes([
        { kind: 'photo', size: 100, count: 1 },
        { kind: 'sticker', size: 25, count: 2 },
        { kind: 'other', size: -7, count: 0 },
      ]),
    ).toBe(125)
  })

  it('answers 0 for nothing ticked', () => {
    expect(sumBucketSizes([])).toBe(0)
  })
})
