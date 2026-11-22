import type { PeerStatus } from '@wegram/protocol'

import type { TdObject } from '../client'

/**
 * TDLib `UserStatus` → the presence DTO.
 *
 * `userStatusOffline` carries the exact time; the three coarse statuses exist
 * because the account's privacy settings hide the hour. `by_my_privacy_settings`
 * does not change the copy: this client shows the coarse sentence instead of
 * inventing a timestamp either way.
 */
export function mapPeerStatus(status: TdObject | undefined): PeerStatus | null {
  switch (status?._) {
    case 'userStatusOnline':
      return { kind: 'online' }
    case 'userStatusOffline': {
      const wasOnline = Number(status.was_online ?? 0)
      return Number.isFinite(wasOnline) && wasOnline > 0
        ? { kind: 'offline', wasOnline }
        : { kind: 'recently' }
    }
    case 'userStatusRecently':
      return { kind: 'recently' }
    case 'userStatusLastWeek':
      return { kind: 'lastWeek' }
    case 'userStatusLastMonth':
      return { kind: 'lastMonth' }
    default:
      return null
  }
}
