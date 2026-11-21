import { describe, expect, it } from 'vitest'

import { bubblePriority, MEDIA_PRIORITY, thumbPriority } from './mediaPriority'

describe('the media priority ladder', () => {
  it('keeps a thumbnail ahead of the picture it stands in for', () => {
    expect(thumbPriority(true)).toBeGreaterThan(bubblePriority(true))
    expect(thumbPriority(false)).toBeGreaterThan(bubblePriority(false))
  })

  it('puts what is on screen ahead of what is one screen away', () => {
    expect(bubblePriority(true)).toBeGreaterThan(bubblePriority(false))
    expect(thumbPriority(true)).toBeGreaterThan(thumbPriority(false))
  })

  it('ranks a watched clip and a save above every bubble', () => {
    expect(MEDIA_PRIORITY.viewer).toBeGreaterThan(MEDIA_PRIORITY.streaming)
    expect(MEDIA_PRIORITY.streaming).toBeGreaterThan(thumbPriority(true))
    expect(MEDIA_PRIORITY.deck).toBeLessThan(bubblePriority(false))
  })
})
