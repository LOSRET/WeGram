import { useCallback, useRef, useState } from 'react'

import { HISTORY_PAGE_SIZE } from '../../../lib/history'
import { errorMessage, invoke } from '../../../lib/ipc'
import { useAppStore } from '../../../store/useAppStore'

/**
 * Older and newer pages of the loaded window, including the buffered page
 * `usePrefetchOlder` kept in hand.
 */
export function usePaging(activeChatId: number | null): {
  loadingOlder: boolean
  loadOlder: () => Promise<void>
  loadNewer: () => Promise<void>
} {
  const [loadingOlder, setLoadingOlder] = useState(false)

  const loadOlder = useCallback(async (): Promise<void> => {
    if (activeChatId === null) return
    const store = useAppStore.getState()
    const oldest = (store.messagesByChat[activeChatId] ?? [])[0]
    if (!oldest) return

    /**
     * Fetched ahead of the reader: the page is already in hand, so the wheel
     * never waits for a server round trip and the "正在加载更早的消息…" chip never
     * flashes. The list's anchored compensation still runs afterwards — that is
     * one prepend, which is the cheap half of the old wait.
     */
    const buffered = store.olderPagesByChat[activeChatId]
    if (buffered !== undefined && buffered.afterId === oldest.id) {
      store.prependHistory(activeChatId, buffered.messages, buffered.hasMore)
      return
    }

    setLoadingOlder(true)
    try {
      const older = await invoke('messages:history', {
        chatId: activeChatId,
        fromMessageId: oldest.id,
        limit: HISTORY_PAGE_SIZE,
      })
      useAppStore.getState().prependHistory(activeChatId, older.messages, older.hasMore)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setLoadingOlder(false)
    }
  }, [activeChatId])

  /** One ref at a time: the scroll handler can fire many times at the edge. */
  const loadingNewerRef = useRef(false)
  const loadNewer = useCallback(async (): Promise<void> => {
    if (activeChatId === null || loadingNewerRef.current) return
    const store = useAppStore.getState()
    if (store.hasNewerByChat[activeChatId] !== true) return
    const last = (store.messagesByChat[activeChatId] ?? []).at(-1)
    if (!last) return

    loadingNewerRef.current = true
    try {
      const newer = await invoke('messages:newer', {
        chatId: activeChatId,
        fromMessageId: last.id,
        limit: HISTORY_PAGE_SIZE,
      })
      useAppStore.getState().appendNewer(activeChatId, newer.messages, newer.hasNewer)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      loadingNewerRef.current = false
    }
  }, [activeChatId])

  return { loadingOlder, loadOlder, loadNewer }
}
