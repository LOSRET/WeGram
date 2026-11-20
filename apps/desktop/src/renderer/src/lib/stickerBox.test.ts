import { describe, expect, it } from 'vitest'

import { PREMIUM_EFFECT_SCALE, premiumEffectBox, stickerBox } from './stickerBox'

describe('stickerBox', () => {
  it('fits the sticker aspect inside the square bound', () => {
    expect(stickerBox({ width: 512, height: 512 }, 140)).toEqual({ width: 140, height: 140 })
    expect(stickerBox({ width: 512, height: 256 }, 140)).toEqual({ width: 140, height: 70 })
    expect(stickerBox({ width: 256, height: 512 }, 140)).toEqual({ width: 70, height: 140 })
  })

  it('falls back to a square sticker when TDLib has no dimensions yet', () => {
    expect(stickerBox({}, 140)).toEqual({ width: 140, height: 140 })
  })

  it('never goes below the 24 px floor', () => {
    expect(stickerBox({ width: 1000, height: 100 }, 140)).toEqual({ width: 140, height: 24 })
  })

  it('lets inline custom emoji draw below that floor', () => {
    expect(stickerBox({ width: 512, height: 512 }, 20, 8)).toEqual({ width: 20, height: 20 })
  })
})

describe('premiumEffectBox', () => {
  it('is the official 1.49x square around the longest sticker edge', () => {
    expect(PREMIUM_EFFECT_SCALE).toBeCloseTo(1.49, 5)
    expect(premiumEffectBox({ width: 140, height: 140 })).toEqual({ width: 209, height: 209 })
    // A wide sticker's effect still squares up on the wide edge.
    expect(premiumEffectBox({ width: 140, height: 70 })).toEqual({ width: 209, height: 209 })
  })
})
