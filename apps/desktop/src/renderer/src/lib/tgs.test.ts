import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadTgsAnimation, markTgsFailure } from './tgs'

describe('TGS failure cooldown', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips a URL that just failed', async () => {
    markTgsFailure('wx-media://f/just-broke')
    await expect(loadTgsAnimation('wx-media://f/just-broke')).rejects.toThrow('recently failed')
  })

  it('lets a URL try again once the cooldown has passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    markTgsFailure('wx-media://f/heals')
    vi.setSystemTime(new Date('2026-01-01T00:02:00Z'))

    // Past the cooldown the guard steps aside, so the failure now comes from the
    // fetch itself (a custom scheme does not resolve under vitest).
    const error = await loadTgsAnimation('wx-media://f/heals').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    if (error instanceof Error) expect(error.message).not.toContain('recently failed')
  })
})
