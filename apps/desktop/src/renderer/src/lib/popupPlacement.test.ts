import { describe, expect, it } from 'vitest'

import {
  POPUP_EDGE,
  placeAgainstAnchor,
  placeAtPoint,
  type PopupAnchor,
} from './popupPlacement'

const VIEWPORT = { width: 1000, height: 800 }
const SIZE = { width: 200, height: 120 }
const ANCHOR: PopupAnchor = { left: 400, right: 440, top: 300, bottom: 330 }

describe('placeAtPoint', () => {
  it('keeps a card that fits where it was asked for', () => {
    expect(placeAtPoint({ x: 100, y: 200 }, SIZE, { centerX: false }, VIEWPORT)).toEqual({
      left: 100,
      top: 200,
    })
  })

  it('clamps to the left and top window edges', () => {
    expect(placeAtPoint({ x: 0, y: 0 }, SIZE, { centerX: false }, VIEWPORT)).toEqual({
      left: POPUP_EDGE,
      top: 0,
    })
  })

  it('flips above a point that has no room below', () => {
    expect(placeAtPoint({ x: 500, y: 790 }, SIZE, { centerX: false }, VIEWPORT).top).toBe(670)
  })

  it('centres on x when asked', () => {
    expect(placeAtPoint({ x: 500, y: 10 }, SIZE, { centerX: true }, VIEWPORT)).toEqual({
      left: 400,
      top: 10,
    })
  })
})

describe('placeAgainstAnchor', () => {
  it('hangs below, left-aligned, one gap away', () => {
    expect(placeAgainstAnchor(ANCHOR, SIZE, {}, VIEWPORT)).toEqual({ left: 400, top: 336 })
  })

  it('aligns the right edges when asked', () => {
    expect(placeAgainstAnchor(ANCHOR, SIZE, { align: 'right' }, VIEWPORT).left).toBe(240)
  })

  it('centres on the anchor when asked', () => {
    expect(placeAgainstAnchor(ANCHOR, SIZE, { align: 'center' }, VIEWPORT).left).toBe(320)
  })

  it('flips above a button near the bottom instead of covering it', () => {
    const low: PopupAnchor = { left: 100, right: 140, top: 740, bottom: 770 }
    expect(placeAgainstAnchor(low, SIZE, {}, VIEWPORT).top).toBe(740 - 6 - 120)
  })

  it('flips below when asked to sit above a button near the top', () => {
    const high: PopupAnchor = { left: 100, right: 140, top: 20, bottom: 50 }
    expect(placeAgainstAnchor(high, SIZE, { side: 'above' }, VIEWPORT).top).toBe(56)
  })

  it('clamps a right-aligned card against the left edge', () => {
    const left: PopupAnchor = { left: 10, right: 40, top: 300, bottom: 330 }
    expect(placeAgainstAnchor(left, SIZE, { align: 'right' }, VIEWPORT).left).toBe(POPUP_EDGE)
  })
})
