import { describe, expect, it } from 'vitest'

import { PLAYBACK_RATES, playerClock, progressRatio, seekTarget, timeAtRatio } from './player'

describe('playerClock', () => {
  it('pads to mm:ss like the client', () => {
    expect(playerClock(0)).toBe('00:00')
    expect(playerClock(1)).toBe('00:01')
    expect(playerClock(51)).toBe('00:51')
    expect(playerClock(600)).toBe('10:00')
  })

  it('adds the hour only when there is one', () => {
    expect(playerClock(3600)).toBe('1:00:00')
    expect(playerClock(3723)).toBe('1:02:03')
  })

  it('floors fractions and survives nonsense', () => {
    expect(playerClock(9.9)).toBe('00:09')
    expect(playerClock(Number.NaN)).toBe('00:00')
    expect(playerClock(-4)).toBe('00:00')
  })
})

describe('progressRatio', () => {
  it('is the played fraction of the clip', () => {
    expect(progressRatio(5, 10)).toBe(0.5)
    expect(progressRatio(0, 10)).toBe(0)
    expect(progressRatio(10, 10)).toBe(1)
  })

  it('is an empty bar while the duration is unknown', () => {
    expect(progressRatio(5, 0)).toBe(0)
    expect(progressRatio(5, Number.NaN)).toBe(0)
  })

  it('never leaves 0…1', () => {
    expect(progressRatio(20, 10)).toBe(1)
    expect(progressRatio(-1, 10)).toBe(0)
  })
})

describe('seekTarget', () => {
  it('moves by the delta and stops at the ends', () => {
    expect(seekTarget(4, 10, 5)).toBe(9)
    expect(seekTarget(4, 10, -5)).toBe(0)
    expect(seekTarget(9, 10, 5)).toBe(10)
  })

  it('returns 0 while the duration is unknown', () => {
    expect(seekTarget(4, 0, 5)).toBe(0)
  })
})

describe('timeAtRatio', () => {
  it('maps a click on the timeline to seconds', () => {
    expect(timeAtRatio(0.5, 10)).toBe(5)
    expect(timeAtRatio(0, 10)).toBe(0)
    expect(timeAtRatio(1.4, 10)).toBe(10)
  })
})

describe('PLAYBACK_RATES', () => {
  it('is the client list, slowest first, with 1x in it', () => {
    expect([...PLAYBACK_RATES]).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2])
  })
})
