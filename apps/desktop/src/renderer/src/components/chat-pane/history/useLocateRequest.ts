import { useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from '../../../lib/ipc'
import { useAppStore } from '../../../store/useAppStore'
import { AROUND_CONTEXT } from './types'

/** How long a 定位到聊天位置 row stays marked for the list to scroll to and flash. */
const LOCATED_CLEAR_MS = 1600

/**
 * 定位到聊天位置 on a conversation that is already open. Waiting for
 * `anchorKnown` keeps this off the first-page path (that one pages *around* the
 * row before mounting the list, so nothing is fetched twice).
 */
export function useLocateRequest(
  activeChatId: number | null,
  anchorKnown: boolean,
): { located: { chatId: number; messageId: number } | null } {
  const [located, setLocated] = useState<{ chatId: number; messageId: number } | null>(null)
  const locate = useAppStore((state) => state.locate)
  /** The locate tick whose window fetch already came back without the row. */
  const locateFetched = useRef<number | null>(null)
  /**
   * The located row may arrive with a page that keeps the row *count* unchanged (a
   * window loaded around it), so the effect below watches the array itself rather
   * than a length: `setHistory` replaces it, which is exactly when to look again.
   */
  const locatedMessages = useAppStore((state) =>
    activeChatId === null ? null : (state.messagesByChat[activeChatId] ?? null),
  )

  useEffect(() => {
    if (locate === null || locate.chatId !== activeChatId) return
    if (!anchorKnown) return
    const store = useAppStore.getState()
    const loaded = locatedMessages ?? []
    if (loaded.some((message) => message.id === locate.messageId)) {
      setLocated({ chatId: locate.chatId, messageId: locate.messageId })
      store.clearLocate()
      return
    }
    /**
     * Nothing to fetch: an empty transcript has no row, and a window that came
     * back without it means the message is gone. Clearing the request stops the
     * effect from asking again — it would otherwise loop on every page.
     */
    if (loaded.length === 0 || locateFetched.current === locate.tick) {
      store.clearLocate()
      return
    }
    locateFetched.current = locate.tick
    let cancelled = false
    void invoke('messages:around', {
      chatId: activeChatId,
      messageId: locate.messageId,
      limit: AROUND_CONTEXT,
    })
      .then((around) => {
        if (cancelled) return
        // The reader asked for this row, so replacing the window is the point:
        // the list lands there instead of paging towards it.
        useAppStore
          .getState()
          .setHistory(activeChatId, around.messages, around.hasMore, around.hasNewer)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        useAppStore.getState().setError(errorMessage(error))
        useAppStore.getState().clearLocate()
      })
    return () => {
      cancelled = true
    }
  }, [locate, activeChatId, anchorKnown, locatedMessages])

  /** The flash is one shot: a remount of the list must not replay it. */
  useEffect(() => {
    if (located === null) return
    const timer = window.setTimeout(() => setLocated(null), LOCATED_CLEAR_MS)
    return () => window.clearTimeout(timer)
  }, [located])

  return { located }
}
