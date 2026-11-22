import type { PeerStatus } from '@wegram/protocol'

import { mapPeerStatus } from '../map/status'
import type { ActionDeps } from './deps'

/**
 * 在线 / 最后上线 for one person.
 *
 * TDLib keeps the current status on the basic user object, so this is an offline
 * call in the normal case. A status the server has not told us about yet maps to
 * `null`: the header then shows nothing rather than a wrong sentence.
 */
export async function userStatus(
  deps: Pick<ActionDeps, 'invoke'>,
  userId: number,
): Promise<PeerStatus | null> {
  const user = await deps.invoke({ _: 'getUser', user_id: userId })
  return mapPeerStatus(user?.status)
}
