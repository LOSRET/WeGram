import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VOLUME,
  isSilent,
  PLAYBACK_RATES,
  playerClock,
  progressRatio,
  readVolume,
  seekTarget,
  timeAtRatio,
  volumeAtPoint,
  VOLUME_STEP,
} from './player'

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

describe('readVolume', () => {
  it('keeps a stored level and clamps it to 0…1', () => {
    expect(readVolume(0.6)).toBe(0.6)
    expect(readVolume(0)).toBe(0)
    expect(readVolume(1.4)).toBe(1)
    expect(readVolume(-0.2)).toBe(0)
  })

  it('reads "never stored" as full volume, never as silence', () => {
    expect(readVolume(null)).toBe(DEFAULT_VOLUME)
    expect(readVolume(undefined)).toBe(DEFAULT_VOLUME)
    expect(readVolume(Number.NaN)).toBe(DEFAULT_VOLUME)
  })
})

describe('volumeAtPoint', () => {
  it('makes the top of the capsule 100 % and its bottom 0 %', () => {
    expect(volumeAtPoint(0, 100)).toBe(1)
    expect(volumeAtPoint(50, 100)).toBe(0.5)
    expect(volumeAtPoint(100, 100)).toBe(0)
  })

  it('clamps a drag that leaves the track', () => {
    expect(volumeAtPoint(-20, 100)).toBe(1)
    expect(volumeAtPoint(140, 100)).toBe(0)
  })

  it('is silent for a track that has not been laid out', () => {
    expect(volumeAtPoint(10, 0)).toBe(0)
    expect(volumeAtPoint(Number.NaN, 100)).toBe(0)
  })
})

describe('isSilent', () => {
  it('covers both the mute toggle and a level of 0', () => {
    expect(isSilent(true, 0.8)).toBe(true)
    expect(isSilent(false, 0)).toBe(true)
    expect(isSilent(false, 0.8)).toBe(false)
  })
})

describe('VOLUME_STEP', () => {
  it('moves 5 % a key press', () => {
    expect(VOLUME_STEP).toBe(0.05)
  })
})
