import { describe, expect, it } from 'vitest'

import {
  clampPan,
  clampZoom,
  elementSize,
  fitScale,
  isQuarterTurn,
  MAX_ZOOM,
  MIN_ZOOM,
  normaliseRotation,
  rotatedSize,
  stepZoom,
  zoomPercent,
} from './zoom'

const canvas = { width: 1000, height: 600 }

describe('normaliseRotation', () => {
  it('wraps into 0/90/180/270', () => {
    expect(normaliseRotation(0)).toBe(0)
    expect(normaliseRotation(90)).toBe(90)
    expect(normaliseRotation(360)).toBe(0)
    expect(normaliseRotation(-90)).toBe(270)
    expect(normaliseRotation(450)).toBe(90)
  })
})

describe('isQuarterTurn', () => {
  it('is true only for the rotations that swap the box', () => {
    expect(isQuarterTurn(0)).toBe(false)
    expect(isQuarterTurn(90)).toBe(true)
    expect(isQuarterTurn(180)).toBe(false)
    expect(isQuarterTurn(270)).toBe(true)
  })
})

describe('fitScale', () => {
  it('uses the limiting axis of the canvas', () => {
    // 1000/1200 = 0.833 wide, 600/800 = 0.75 tall -> the height decides
    expect(fitScale({ width: 1200, height: 800 }, canvas)).toBeCloseTo(0.75, 6)
  })

  it('swaps the axes for a quarter turn', () => {
    const natural = { width: 1200, height: 800 }
    // rotated: 800 wide, 1200 tall -> height decides at 0.5
    expect(fitScale(natural, canvas, 90)).toBeCloseTo(600 / 1200, 6)
    expect(fitScale(natural, canvas, 270)).toBeCloseTo(0.5, 6)
  })

  it('falls back to 1 while the photo or the canvas is not measured yet', () => {
    expect(fitScale(null, canvas)).toBe(1)
    expect(fitScale({ width: 1200, height: 800 }, { width: 0, height: 0 })).toBe(1)
  })
})

describe('elementSize / rotatedSize', () => {
  const natural = { width: 1200, height: 800 }
  it('scales the box the photo sits in', () => {
    expect(elementSize(natural, 0.5)).toEqual({ width: 600, height: 400 })
  })

  it('reports the covered box after a quarter turn', () => {
    expect(rotatedSize(natural, 0.5, 0)).toEqual({ width: 600, height: 400 })
    expect(rotatedSize(natural, 0.5, 90)).toEqual({ width: 400, height: 600 })
    expect(rotatedSize(natural, 0.5, 180)).toEqual({ width: 600, height: 400 })
  })
})

describe('zoom stepping', () => {
  it('clamps into the displayable range', () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM)
    expect(clampZoom(50)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  it('multiplies and divides by one step', () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.25, 6)
    expect(stepZoom(1, -1)).toBeCloseTo(0.8, 6)
    // never leaves the range: 8 * 1.25 is capped
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
  })

  it('prints the ratio against the photo pixels', () => {
    expect(zoomPercent(1)).toBe('100%')
    expect(zoomPercent(0.375)).toBe('38%')
  })
})

describe('clampPan', () => {
  it('lets a zoomed photo move only within its overflow', () => {
    const photo = { width: 2000, height: 1200 }
    expect(clampPan({ x: 9999, y: -9999 }, photo, canvas)).toEqual({ x: 500, y: -300 })
    expect(clampPan({ x: 100, y: -80 }, photo, canvas)).toEqual({ x: 100, y: -80 })
  })

  it('pins a photo smaller than the canvas to the centre', () => {
    expect(clampPan({ x: 120, y: 40 }, { width: 400, height: 300 }, canvas)).toEqual({ x: 0, y: 0 })
  })
})
