import { describe, expect, it } from 'vitest'

import { JUMP_ARRIVED_PX, nextJumpStep } from './jumpSettle'

const progress = (gap: number, previousGap: number, elapsed = 0, deadline = 900) =>
  ({ gap, previousGap, elapsed, deadline }) as const

describe('nextJumpStep', () => {
  it('stops as soon as the bottom is in view', () => {
    expect(nextJumpStep(progress(0, 4000))).toBe('landed')
    expect(nextJumpStep(progress(JUMP_ARRIVED_PX, 4000))).toBe('landed')
  })

  it('keeps watching an animation that is still moving', () => {
    expect(nextJumpStep(progress(4000, 9000))).toBe('wait')
  })

  it('finishes a move whose animation stopped short', () => {
    // Measured case: the first row measured on the way down changes the scroll
    // range, Chromium cancels the smooth scroll, and the gap stops shrinking. The
    // reader used to be left there with the buoy already gone.
    expect(nextJumpStep(progress(19544, 19544))).toBe('stalled')
  })

  it('gives up at the deadline and stops even if the end keeps growing', () => {
    // Late row measurement keeps extending the content; the move must not spin for
    // ever, and the pin glues the remaining growth once it has landed.
    expect(nextJumpStep(progress(300, 900, 900, 900))).toBe('give-up')
    expect(nextJumpStep(progress(300, 900, 1200, 900))).toBe('give-up')
  })

  it('lands rather than gives up when both apply', () => {
    expect(nextJumpStep(progress(0, 0, 5000, 900))).toBe('landed')
  })
})
