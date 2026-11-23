import type { ChatSummary } from '@wegram/protocol'
import { useEffect, useRef } from 'react'

import { missingAvatarIds } from './chatAvatars'
import { invoke } from './ipc'

/** Coalesce a fast wheel into one request. */
const FLUSH_MS = 200
/** `chats:prefetchAvatars` takes at most this many ids per call. */
const BATCH = 64

/**
 * 头像按需: queue the photos of the rows the list is showing.
 *
 * The adapter's photo pool only prefetches the page it was handed, and `ChatRow`
 * reads nothing but `chat.avatarUrl` — so a chat that was never in a fetched page
 * (paged in, or pushed by an update without its photo) draws its initials for the
 * rest of the session. Asking for the visible window closes that gap; each photo
 * comes back as a `chats` upsert, exactly like the start-up prefetch.
 *
 * Ran for one range per render, coalesced, and never re-asked for an id: the pool
 * dedupes too, but the renderer should not spend an IPC round trip per scroll tick.
 */
export function useChatAvatarPrefetch(chats: ChatSummary[], from: number, to: number): void {
  const requested = useRef(new Set<number>())
  const pending = useRef<number[]>([])
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const ids = missingAvatarIds(chats, from, to, requested.current)
    if (ids.length === 0) return
    for (const id of ids) requested.current.add(id)
    pending.current.push(...ids)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      const batch = pending.current
      pending.current = []
      for (let i = 0; i < batch.length; i += BATCH) {
        // Best effort: a failed prefetch only means initials until the next scroll.
        void invoke('chats:prefetchAvatars', { chatIds: batch.slice(i, i + BATCH) }).catch(
          () => undefined,
        )
      }
    }, FLUSH_MS)
  }, [chats, from, to])

  // An unmount (the archive page closing, the shell switching account) must not
  // leave a timer that fires into a dead store.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
}
