import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'
import { resolveLanding } from '../message-list/unread'
import { readFirstPage } from './history/readFirstPage'
import { ColdCacheError, type ChatHistoryState, type PendingLanding } from './history/types'
import { useLocateRequest } from './history/useLocateRequest'
import { usePaging } from './history/usePaging'
import { usePrefetchOlder } from './history/usePrefetchOlder'

/** An empty first page is usually a cold TDLib cache: ask again before caching it. */
const EMPTY_PAGE_RETRIES = 3
const EMPTY_PAGE_RETRY_DELAY_MS = 800
/** One quiet retry after a failed first fetch (the proxy tunnel here flaps). */
const FAILED_FETCH_RETRY_DELAY_MS = 1500

/**
 * Owns the transcript's data lifecycle for the active chat: the first page, the
 * window around a deep landing row, and older/newer pages.
 *
 * React-query owns the request (key per chat, retries, cancellation, pending
 * flags); the store stays the single source of truth for the message list, so the
 * `evt:messages` stream keeps writing to one place. What this hook adds is the one
 * ordering rule react-query cannot know about: the landing position is resolved
 * *before* `anchorKnown` opens the mount gate.
 *
 * Each concern lives beside this file under `history/`: the fetch itself
 * (`readFirstPage`), the 定位到聊天位置 request (`useLocateRequest`), the
 * speculative older page (`usePrefetchOlder`) and the two page loads
 * (`usePaging`).
 */
export function useChatHistory(activeChatId: number | null): ChatHistoryState {
  const [pendingLanding, setPendingLanding] = useState<PendingLanding | null>(null)
  const [anchorKnown, setAnchorKnown] = useState(false)
  const [restoring, setRestoring] = useState(false)
  /**
   * The chat the state above belongs to.
   *
   * Adjusted *during render*, not in an effect, and that is load-bearing. An effect
   * runs after a render that still carries the previous chat's `anchorKnown === true`,
   * so `ChatPane` mounted the list for the new chat one frame early — with no landing,
   * because `pendingLanding` is per chat — and that mount landed at the bottom and
   * wrote `bottom` into `ui.db` before the new chat's `ui:getAnchor` could read the
   * stored row. Every *cached* chat (a chat opened before in this session) therefore
   * reopened at the bottom instead of at its saved position. React re-renders before
   * committing children, so with the reset here no frame ever sees the stale flag.
   */
  const [stateChatId, setStateChatId] = useState<number | null>(null)
  /**
   * Whether the active chat needs its first page. Sampled once per chat, together
   * with the reset above, because it also decides whether the list has to wait for
   * a fetch at all: an entry that already has rows is only missing its anchor.
   *
   * It is deliberately *not* derived from the live length — the query writes the page
   * into the store itself, and a reactive `enabled` would flip to false mid-flight.
   */
  const [needsFetch, setNeedsFetch] = useState(false)
  if (stateChatId !== activeChatId) {
    setStateChatId(activeChatId)
    setPendingLanding(null)
    setAnchorKnown(false)
    setRestoring(false)
    setNeedsFetch(
      activeChatId !== null &&
        (useAppStore.getState().messagesByChat[activeChatId]?.length ?? 0) === 0,
    )
  }

  const history = useQuery({
    queryKey: ['history', activeChatId],
    queryFn: ({ signal }) => {
      if (activeChatId === null) throw new Error('useChatHistory: no active chat')
      return readFirstPage(activeChatId, signal, () => {
        if (!signal.aborted) setRestoring(true)
      })
    },
    enabled: activeChatId !== null && needsFetch,
    /**
     * The two failures have different rhythms, and the old hand-written retries are
     * exactly these two numbers: an empty page is retried three times 800 ms apart
     * (cold TDLib cache), a failed fetch once after 1.5 s (the proxy tunnel flaps).
     */
    retry: (failureCount, error) =>
      error instanceof ColdCacheError ? failureCount < EMPTY_PAGE_RETRIES : failureCount < 1,
    retryDelay: (failureCount, error) =>
      error instanceof ColdCacheError ? EMPTY_PAGE_RETRY_DELAY_MS : FAILED_FETCH_RETRY_DELAY_MS,
  })

  const page = history.data
  const historyErrorMessage = history.isError ? errorMessage(history.error) : null
  const refetch = history.refetch
  /** The error this hook put on screen, so a successful retry can take it away. */
  const reportedErrorRef = useRef<string | null>(null)

  // Already in memory: no fetch, the list only needs the anchor to restore.
  useEffect(() => {
    if (activeChatId === null || needsFetch) return
    let cancelled = false
    const store = useAppStore.getState()
    const messages = store.messagesByChat[activeChatId] ?? []
    const marker = store.unreadMarkers[activeChatId] ?? null
    // No fetch on this path, so the unread divider can only be honoured if its row
    // is already cached; otherwise `resolveLanding` falls back to the oldest loaded
    // row, which is the documented deep-unread behaviour.
    void invoke('ui:getAnchor', { chatId: activeChatId })
      .catch(() => null)
      .then((anchor) => {
        if (cancelled) return
        const landing = resolveLanding(messages, marker, anchor)
        setPendingLanding(landing ? { chatId: activeChatId, position: landing } : null)
        setAnchorKnown(true)
      })
    return () => {
      cancelled = true
    }
  }, [activeChatId, needsFetch])

  // The first page landed: hand the landing over, then open the mount gate.
  useEffect(() => {
    if (activeChatId === null || !needsFetch || !page || page.chatId !== activeChatId) return
    setPendingLanding(page.landing ? { chatId: page.chatId, position: page.landing } : null)
    setRestoring(false)
    setAnchorKnown(true)
    const reported = reportedErrorRef.current
    if (reported !== null && useAppStore.getState().error === reported) {
      useAppStore.getState().setError(null)
    }
    reportedErrorRef.current = null
  }, [activeChatId, needsFetch, page])

  useEffect(() => {
    if (activeChatId === null || !needsFetch || historyErrorMessage === null) return
    reportedErrorRef.current = historyErrorMessage
    useAppStore.getState().setError(historyErrorMessage)
    setRestoring(false)
    // Even on failure the list is mounted: it then falls back to the bottom.
    setAnchorKnown(true)
  }, [activeChatId, needsFetch, historyErrorMessage])

  const messageCount = useAppStore((state) =>
    activeChatId === null ? 0 : (state.messagesByChat[activeChatId]?.length ?? 0),
  )
  const hasNewer = useAppStore((state) =>
    activeChatId === null ? false : state.hasNewerByChat[activeChatId] === true,
  )

  const { located } = useLocateRequest(activeChatId, anchorKnown)
  const prefetchOlder = usePrefetchOlder(activeChatId)
  const { loadingOlder, loadOlder, loadNewer } = usePaging(activeChatId)

  const hadRowsFor = useRef<number | null>(null)
  /**
   * A transcript that had rows and now has none was not emptied by the reader, so
   * it is worth asking again once instead of parking the pane on
   * "这个会话还没有可显示的消息" until someone finds 重新加载.
   *
   * That state has exactly one producer: a `delete` op batch (a `setHistory` page
   * that is empty does not remove rows already in memory). It can be *wrong* —
   * TDLib reported a local-cache eviction of all 50 cached messages as a deletion
   * on an idle background app, and the adapter now filters those out — but this
   * net also covers any future silent wipe. The ref bounds it to one attempt: if
   * the refetched page is empty too, nothing had rows any more and it stops.
   */
  useEffect(() => {
    if (activeChatId === null) {
      hadRowsFor.current = null
      return
    }
    if (messageCount > 0) {
      hadRowsFor.current = activeChatId
      return
    }
    if (hadRowsFor.current !== activeChatId) return
    if (!anchorKnown || history.isFetching) return
    hadRowsFor.current = null
    void refetch()
  }, [activeChatId, messageCount, anchorKnown, history.isFetching, refetch])

  const reload = useCallback((): void => {
    reportedErrorRef.current = null
    void refetch()
  }, [refetch])

  return {
    pendingLanding,
    anchorKnown,
    restoring,
    loadingHistory: needsFetch && (history.isPending || history.isFetching),
    located,
    loadingOlder,
    prefetchOlder,
    hasNewer,
    reload,
    loadOlder,
    loadNewer,
  }
}
