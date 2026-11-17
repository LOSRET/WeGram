import { describe, expect, it } from 'vitest'

import { VIEWER_MIN_H, VIEWER_MIN_W, viewerWindowSize } from './viewer-size'

// The display the client's viewer was measured on: 1920×1080 at 125 %.
const screen = { width: 1536, height: 864 }
const workArea = { width: 1536, height: 816 }

describe('viewerWindowSize', () => {
  it('reproduces the measured 75 % × 90 % window', () => {
    expect(viewerWindowSize({ screen, workArea })).toEqual({ width: 1152, height: 778 })
  })

  it('never grows past the work area', () => {
    const tiny = { width: 800, height: 600 }
    expect(viewerWindowSize({ screen, workArea: tiny })).toEqual({
      width: 800 - 16,
      height: 600 - 16,
    })
  })

  it('keeps the toolbar usable on a small display', () => {
    const size = viewerWindowSize({
      screen: { width: 640, height: 480 },
      workArea: { width: 640, height: 400 },
    })
    expect(size.width).toBe(VIEWER_MIN_W)
    expect(size.height).toBe(VIEWER_MIN_H)
  })
})
