import { describe, expect, it } from 'vitest'

import { POLL_REFRESH_MS, pollRefreshInterval } from './pollRefresh'

describe('poll refresh timing', () => {
  it("re-reads an open poll sooner than TDLib's own results poll", () => {
    expect(POLL_REFRESH_MS).toBe(10_000)
    expect(pollRefreshInterval({ closed: false })).toBe(POLL_REFRESH_MS)
  })

  it('stops once the poll is closed', () => {
    expect(pollRefreshInterval({ closed: true })).toBeNull()
  })
})
