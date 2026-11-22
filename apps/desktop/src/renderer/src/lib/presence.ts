import type { PeerStatus } from '@wegram/protocol'

/**
 * 在线 / 最后上线, in the client's own words.
 *
 * Pure and clock-injected so the copy is unit-tested (`presence.test.ts`). The
 * coarse statuses exist because Telegram hides the exact time behind privacy
 * settings: this function shows the sentence TDLib actually supports instead of
 * inventing a timestamp.
 */
const MINUTE_MS = 60_000

export function formatPeerStatus(status: PeerStatus, nowMs: number): string {
  switch (status.kind) {
    case 'online':
      return '在线'
    case 'recently':
      return '最近在线'
    case 'lastWeek':
      return '一周内在线'
    case 'lastMonth':
      return '一个月内在线'
    case 'offline':
      return formatLastSeen(status.wasOnline * 1000, nowMs)
  }
}

/** `userStatusOffline.was_online` is Unix seconds; the copy uses local time. */
export function formatLastSeen(wasOnlineMs: number, nowMs: number): string {
  if (!Number.isFinite(wasOnlineMs) || wasOnlineMs <= 0) return '最近在线'
  if (nowMs - wasOnlineMs < MINUTE_MS) return '刚刚在线'
  const seen = new Date(wasOnlineMs)
  const time = `${pad(seen.getHours())}:${pad(seen.getMinutes())}`
  const today = new Date(nowMs)
  if (sameDay(seen, today)) return `最后上线 今天 ${time}`
  const yesterday = new Date(nowMs)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(seen, yesterday)) return `最后上线 昨天 ${time}`
  return `最后上线 ${seen.getMonth() + 1}月${seen.getDate()}日 ${time}`
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
