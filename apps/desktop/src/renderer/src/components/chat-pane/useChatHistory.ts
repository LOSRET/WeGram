import { useQuery } from '@tanstack/react-query'
import type { Message } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { emptyPageIsHistory } from '../../lib/history'
import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'
import { pickPagingTarget, resolveLanding, type LandingPosition } from '../message-list/unread'

/** How many extra pages may be fetched to reach a saved reading position. */
const MAX_RESTORE_PAGES = 6
/** How many extra pages may be fetched to reach the unread divider (deep unread). */
const MAX_UNREAD_PAGES = 8
/** Give up paging back (and land at the bottom) after this long. */
const RESTORE_BUDGET_MS = 10_000
/** Page size for the first page and for every "older" page. */
const PAGE_SIZE = 50
/** An empty first page is usually a cold TDLib cache: ask again before caching it. */
const EMPTY_PAGE_RETRIES = 3
const EMPTY_PAGE_RETRY_DELAY_MS = 800
/** One quiet retry after a failed first fetch (the proxy tunnel here flaps). */
const FAILED_FETCH_RETRY_DELAY_MS = 1500

export interface PendingLanding {
  chatId: number
  position: LandingPosition
}

export interface ChatHistoryState {
  /** Where this chat opens: saved row, unread divider, or null → newest message. */
  pendingLanding: PendingLanding | null
  /**
   * The anchor has been resolved for the active chat. The list must not mount
   * before that: it captures its reading position once on the first paint, and a
   * cached chat would otherwise land at the bottom and miss the restore.
   */
  anchorKnown: boolean
  /** Paging back towards a saved anchor (can take a moment on the real account). */
  restoring: boolean
  /** The first page is still in flight; the pane shows its loading state while empty. */
  loadingHistory: boolean
  loadingOlder: boolean
  /** Empty-state "reload" button: re-runs the first-page fetch. */
  reload: () => void
  loadOlder: () => Promise<void>
}

/** What one first-page fetch produced, cached by react-query per chat. */
interface FirstPage {
  chatId: number
  messages: Message[]
  hasMore: boolean
  landing: LandingPosition | null
}

/**
 * The page came back empty although the chat list says the conversation has
 * messages. TDLib answers like that right after a start, while its local database
 * is still syncing, and caching it is the "blank transcript for the rest of the
 * session" bug. It is thrown, not returned, so that the query's `retry` owns the
 * decision to ask again and the cache holds an **error instead of an empty page** —
 * the next open, or 重新加载, therefore asks again by construction.
 */
class ColdCacheError extends Error {
  constructor() {
    super('messages:history returned an empty page the chat list contradicts')
    this.name = 'ColdCacheError'
  }
}

/**
 * The whole first-page flow, in the order it has to happen:
 *   1. resolve the stored anchor (`ui:getAnchor`) — before the list may mount,
 *   2. fetch the first page (an empty answer the chat list contradicts throws),
 *   3. page back until the landing message is loaded, within a budget,
 *   4. hand the page to the store, which replays any ops that arrived meanwhile.
 *
 * It runs inside the query function, so react-query owns retries, cancellation and
 * the pending flags instead of a hand-written state machine.
 */
async function readFirstPage(
  chatId: number,
  signal: AbortSignal,
  onRestoring: () => void,
): Promise<FirstPage> {
  const anchor = await invoke('ui:getAnchor', { chatId }).catch(() => null)
  signal.throwIfAborted()

  /**
   * The unread snapshot `MainShell` took before `chats:open` reported the chat as
   * read. It is the only source of the read boundary.
   */
  const marker = useAppStore.getState().unreadMarkers[chatId] ?? null
  /**
   * Where the first page has to reach back to. A chat opened with unread messages
   * needs the row the divider goes above; the newest page does not contain it once
   * the unread count passes the page size. `pickPagingTarget` also owns "does the
   * saved position outrank the divider" — the reader who left *after* the read
   * boundary must keep their row.
   */
  const target = pickPagingTarget(anchor, marker)

  const first = await invoke('messages:history', { chatId, limit: PAGE_SIZE })
  signal.throwIfAborted()

  /**
   * The chat list is the only place that knows whether the conversation has any
   * messages at all; `emptyPageIsHistory` owns the rule for using that knowledge.
   * A genuinely empty chat has no `lastMessageAt`, so its empty page is still real.
   */
  const chat = useAppStore.getState().chats.find((item) => item.id === chatId)
  if (first.messages.length === 0 && !emptyPageIsHistory(first, chat)) throw new ColdCacheError()

  let messages = first.messages
  let hasMore = first.hasMore
  const deadline = Date.now() + RESTORE_BUDGET_MS
  const oldest = messages[0]
  if (target !== null && oldest !== undefined && oldest.id > target.messageId) onRestoring()
  // Unread pages get a larger budget than a saved anchor: a chat with 300 unread
  // messages is normal, a reading position 300 messages up is not.
  const pageBudget = target?.kind === 'unread' ? MAX_UNREAD_PAGES : MAX_RESTORE_PAGES
  for (
    let pages = 0;
    target !== null &&
    hasMore &&
    messages[0] !== undefined &&
    messages[0].id > target.messageId &&
    pages < pageBudget &&
    Date.now() < deadline;
    pages += 1
  ) {
    const from = messages[0]
    if (!from) break
    const older = await invoke('messages:history', {
      chatId,
      fromMessageId: from.id,
      limit: PAGE_SIZE,
    })
    signal.throwIfAborted()
    messages = [...older.messages, ...messages]
    hasMore = older.hasMore
  }

  const landing = resolveLanding(messages, marker, anchor)
  signal.throwIfAborted()

  // Past this line the fetch is committed: an aborted query must not leave a page
  // in the store that nobody asked for any more.
  useAppStore.getState().setHistory(chatId, messages, hasMore)
  /**
   * A saved position we actually paged for and still could not reach (deeper than
   * the budget, or deleted): drop it, so the next open stays instant instead of
   * paging back again for nothing. An anchor that lost to the unread divider is
   * *not* dropped — it was never the target, and it is still a valid place to
   * return to once the chat has no unread messages.
   */
  const anchorFound = anchor ? messages.some((message) => message.id === anchor.messageId) : false
  if (target?.kind === 'anchor' && !anchorFound) {
    void invoke('ui:saveAnchor', { chatId, messageId: null, offset: 0 }).catch(() => undefined)
  }

  return { chatId, messages, hasMore, landing }
}

/**
 * Owns the transcript's data lifecycle for the active chat: the first page, the
 * paging needed to reach a saved reading position, and older-page fetching.
 *
 * React-query owns the request (key per chat, retries, cancellation, pending
 * flags); the store stays the single source of truth for the message list, so the
 * `evt:messages` stream keeps writing to one place. What this hook adds is the one
 * ordering rule react-query cannot know about: the landing position is resolved
 * *before* `anchorKnown` opens the mount gate.
 */
export function useChatHistory(activeChatId: number | null): ChatHistoryState {
  const [pendingLanding, setPendingLanding] = useState<PendingLanding | null>(null)
  const [anchorKnown, setAnchorKnown] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
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

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!activeChatId) return
    const oldest = (useAppStore.getState().messagesByChat[activeChatId] ?? [])[0]
    if (!oldest) return

    setLoadingOlder(true)
    try {
      const older = await invoke('messages:history', {
        chatId: activeChatId,
        fromMessageId: oldest.id,
        limit: PAGE_SIZE,
      })
      useAppStore.getState().prependHistory(activeChatId, older.messages, older.hasMore)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setLoadingOlder(false)
    }
  }, [activeChatId])

  return {
    pendingLanding,
    anchorKnown,
    restoring,
    loadingHistory: needsFetch && (history.isPending || history.isFetching),
    loadingOlder,
    reload,
    loadOlder,
  }
}
