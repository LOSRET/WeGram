import { describe, expect, it } from 'vitest'

import { BOTTOM_THRESHOLD_PX, readScrollPin } from './scrollGeometry'

describe('readScrollPin', () => {
  it('treats a transcript shorter than the viewport as pinned', () => {
    // Measured case: the window grew until the whole transcript was visible, but no
    // scroll event ever fires in that state. Geometry has to say "at the bottom".
    const pin = readScrollPin({ scrollHeight: 1386, scrollTop: 0, clientHeight: 1386 })
    expect(pin.fits).toBe(true)
    expect(pin.pinned).toBe(true)
    expect(pin.distance).toBe(0)
  })

  it('reports the virtualizer over-estimating the transcript as fitting only after it shrinks', () => {
    // Rows are laid out from `estimateSize: 68` before they are measured: eight rows
    // look scrollable, then measure to 430px inside a 466px viewport.
    const beforeMeasurement = readScrollPin({
      scrollHeight: 8 * 68,
      scrollTop: 0,
      clientHeight: 466,
    })
    expect(beforeMeasurement.fits).toBe(false)
    expect(beforeMeasurement.pinned).toBe(false)

    const afterMeasurement = readScrollPin({ scrollHeight: 430, scrollTop: 0, clientHeight: 466 })
    expect(afterMeasurement.fits).toBe(true)
    expect(afterMeasurement.pinned).toBe(true)
  })

  it('counts a reader within the threshold of the bottom as pinned', () => {
    const pin = readScrollPin({ scrollHeight: 2000, scrollTop: 1520, clientHeight: 466 })
    expect(pin.fits).toBe(false)
    expect(pin.distance).toBe(14)
    expect(pin.pinned).toBe(true)
  })

  it('does not pin a reader who scrolled up', () => {
    const pin = readScrollPin({ scrollHeight: 2000, scrollTop: 0, clientHeight: 466 })
    expect(pin.fits).toBe(false)
    expect(pin.distance).toBe(1534)
    expect(pin.pinned).toBe(false)
  })

  it('honours a custom threshold', () => {
    const geometry = { scrollHeight: 2000, scrollTop: 1520, clientHeight: 466 }
    expect(readScrollPin(geometry, 8).pinned).toBe(false)
    expect(readScrollPin(geometry).pinned).toBe(true)
    expect(BOTTOM_THRESHOLD_PX).toBe(40)
  })
})
