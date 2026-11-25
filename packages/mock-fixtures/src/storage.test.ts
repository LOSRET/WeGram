import { describe, expect, it } from 'vitest'

import { clearMockStorage, initialMockStorage, trimMockStorage } from './storage'

describe('mock storage cache', () => {
  it('ships the four demo kinds and derives their totals', () => {
    const usage = initialMockStorage()

    expect(usage.buckets.map((bucket) => bucket.kind)).toEqual([
      'photo',
      'sticker',
      'animation',
      'other',
    ])
    expect(usage.mediaSize).toBe(562_769_202)
    expect(usage.mediaCount).toBe(646)
    expect(usage.databaseSize).toBe(100_663_296)
  })

  it('trims every kind proportionally to the ceiling and reports the freed bytes', () => {
    const before = initialMockStorage()
    const ceiling = 512 * 1024 * 1024

    const { usage, freed } = trimMockStorage(before, ceiling)

    expect(usage.mediaSize).toBe(ceiling)
    expect(freed.bytes).toBe(before.mediaSize - ceiling)
    expect(freed.count).toBe(before.mediaCount - usage.mediaCount)
    expect(usage.buckets).toHaveLength(4)
    for (const [index, bucket] of usage.buckets.entries()) {
      expect(bucket.size).toBeLessThanOrEqual(before.buckets[index]?.size ?? 0)
    }
    expect(usage.databaseSize).toBe(before.databaseSize)
  })

  it('leaves the cache alone when the ceiling is above it', () => {
    const before = initialMockStorage()

    const { usage, freed } = trimMockStorage(before, before.mediaSize + 1)

    expect(freed).toEqual({ bytes: 0, count: 0 })
    expect(usage).toEqual(before)
  })

  it('clears only the ticked kinds', () => {
    const before = initialMockStorage()

    const { usage, freed } = clearMockStorage(before, ['photo', 'sticker'])

    expect(usage.buckets.map((bucket) => bucket.kind)).toEqual(['animation', 'other'])
    expect(freed.bytes).toBe(324_429_414 + 154_035_046)
    expect(freed.count).toBe(412 + 88)
    expect(usage.mediaSize).toBe(before.mediaSize - freed.bytes)
    expect(usage.databaseSize).toBe(before.databaseSize)
  })

  it('answers nothing for a kind the cache does not hold', () => {
    const before = initialMockStorage()

    const { usage, freed } = clearMockStorage(before, ['video'])

    expect(freed).toEqual({ bytes: 0, count: 0 })
    expect(usage).toEqual(before)
  })
})
