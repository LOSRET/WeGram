import type { PeerStatus } from '@wegram/protocol'
import { useEffect } from 'react'

import { invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'

/**
 * 在线 / 最后上线 for one person, split out of `chat-pane/index.tsx` when that
 * file reached its size budget.
 *
 * The answer is asked for whenever the conversation opens (TDLib serves it from
 * its cache) and then kept live by `evt:status`, so a peer who goes offline while
 * the chat is open updates without reopening it. A failed lookup is silence: the
 * title simply has no second line.
 */
export function usePeerStatus(userId: number | null): PeerStatus | null {
  const status = useAppStore((state) =>
    userId === null ? undefined : state.peerStatusByUser[userId],
  )

  useEffect(() => {
    if (userId === null) return
    let cancelled = false
    void invoke('users:status', { userId })
      .then((answer) => {
        if (!cancelled && answer) useAppStore.getState().setPeerStatus(userId, answer)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [userId])

  return status ?? null
}
