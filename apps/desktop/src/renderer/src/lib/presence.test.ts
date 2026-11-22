import { describe, expect, it } from 'vitest'

import { formatLastSeen, formatPeerStatus } from './presence'

/** A local date, so the copy is independent of the machine's time zone. */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 10, day, hour, minute).getTime()

describe('formatPeerStatus', () => {
  it('uses the coarse sentences TDLib itself reports', () => {
    expect(formatPeerStatus({ kind: 'online' }, at(22, 9))).toBe('在线')
    expect(formatPeerStatus({ kind: 'recently' }, at(22, 9))).toBe('最近在线')
    expect(formatPeerStatus({ kind: 'lastWeek' }, at(22, 9))).toBe('一周内在线')
    expect(formatPeerStatus({ kind: 'lastMonth' }, at(22, 9))).toBe('一个月内在线')
  })

  it('formats an exact last-seen time in local words', () => {
    const now = at(22, 9)
    expect(formatLastSeen(at(22, 8, 59) + 30_000, now)).toBe('刚刚在线')
    expect(formatLastSeen(at(22, 8, 59), now)).toBe('最后上线 今天 08:59')
    expect(formatLastSeen(at(22, 8, 30), now)).toBe('最后上线 今天 08:30')
    expect(formatLastSeen(at(21, 21, 4), now)).toBe('最后上线 昨天 21:04')
    expect(formatLastSeen(at(10, 9, 0), now)).toBe('最后上线 11月10日 09:00')
  })

  it('never invents a time from a missing or skewed one', () => {
    expect(formatLastSeen(0, at(22, 9))).toBe('最近在线')
    // A clock a little behind the server's: "just now" beats "tomorrow 08:59".
    expect(formatLastSeen(at(22, 9, 1), at(22, 9))).toBe('刚刚在线')
  })
})
