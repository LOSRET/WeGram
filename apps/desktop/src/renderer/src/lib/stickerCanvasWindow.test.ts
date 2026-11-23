import { describe, expect, it } from 'vitest'

import { DROP_SCREENS, LOAD_SCREENS, overlaps, stickerWindow } from './stickerCanvasWindow'

describe('stickerWindow', () => {
  it('parses two screens each way and drops one screen further out', () => {
    const { load, drop } = stickerWindow(1000, 400)
    expect(load).toEqual({ from: 1000 - 400 * LOAD_SCREENS, to: 1000 + 400 * (LOAD_SCREENS + 1) })
    expect(drop).toEqual({
      from: 1000 - 400 * DROP_SCREENS,
      to: 1000 + 400 * (DROP_SCREENS + 1),
    })
  })

  it('never returns an empty screen for a collapsed panel', () => {
    const { load, drop } = stickerWindow(0, 0)
    expect(load).toEqual({ from: -2, to: 3 })
    expect(drop).toEqual({ from: -3, to: 4 })
  })

  it('honours the screen counts it is given', () => {
    const { load, drop } = stickerWindow(100, 50, 0, 1)
    expect(load).toEqual({ from: 100, to: 150 })
    expect(drop).toEqual({ from: 50, to: 200 })
  })

  it('keeps the drop band outside the load band, so the two never coincide', () => {
    const { load, drop } = stickerWindow(0, 100)
    expect(drop.from).toBeLessThan(load.from)
    expect(drop.to).toBeGreaterThan(load.to)
  })
})

describe('overlaps', () => {
  const band = { from: -500, to: 1000 }

  it('counts a cell that ends inside the band', () => {
    expect(overlaps(band, -480, -400)).toBe(true)
  })

  it('counts a cell that starts inside the band', () => {
    expect(overlaps(band, 980, 1060)).toBe(true)
  })

  it('counts a cell that swallows the band', () => {
    expect(overlaps(band, -8000, 8000)).toBe(true)
  })

  it('rejects a cell entirely above or below it', () => {
    expect(overlaps(band, -1080, -1000)).toBe(false)
    expect(overlaps(band, 1000, 1080)).toBe(false)
  })

  it('treats a band edge as outside, so a cell is not parsed twice', () => {
    expect(overlaps(band, -500, -400)).toBe(true)
    expect(overlaps(band, -1000, -500)).toBe(false)
  })
})
