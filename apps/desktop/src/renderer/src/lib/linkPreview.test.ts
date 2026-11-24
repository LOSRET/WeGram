import { describe, expect, it } from 'vitest'

import { previewHue } from './linkPreview'

/**
 * The hue is the card's only content-derived colour: it must be stable (a
 * re-render or a restart may not repaint a link) and it must stay a legal
 * `hsl()` hue, because the stylesheet pastes it into one.
 */
describe('previewHue', () => {
  it('is stable for the same link and a legal hue', () => {
    const hue = previewHue('https://telegra.ph/WeGram-v031-11-24')
    expect(previewHue('https://telegra.ph/WeGram-v031-11-24')).toBe(hue)
    expect(Number.isInteger(hue)).toBe(true)
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
  })

  it('separates different links', () => {
    expect(previewHue('https://a.example/one')).not.toBe(previewHue('https://a.example/two'))
  })

  it('treats an empty seed as hue 0 rather than NaN', () => {
    expect(previewHue('')).toBe(0)
  })
})
