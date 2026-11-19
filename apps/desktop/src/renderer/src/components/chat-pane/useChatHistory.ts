import { useQuery } from '@tanstack/react-query'
import type { Message } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { HISTORY_PAGE_SIZE, emptyPageIsHistory } from '../../lib/history'
import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'
import {
  locateLanding,
  pickPagingTarget,
  resolveLanding,
  type LandingPosition,
  type PagingTarget,
} from '../message-list/unread'

/** Messages kept on each side of a message when a window is loaded around it. */
const AROUND_CONTEXT = 25
/** An empty first page is usually a cold TDLib cache: ask again before caching it. */
const EMPTY_PAGE_RETRIES = 3
const EMPTY_PAGE_RETRY_DELAY_MS = 800
/** One quiet retry after a failed first fetch (the proxy tunnel here flaps). */
const FAILED_FETCH_RETRY_DELAY_MS = 1500
/** How long a 定位到聊天位置 row stays marked for the list to scroll to and flash. */
const LOCATED_CLEAR_MS = 1600

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
  /**
   * The row 定位到聊天位置 asked for, once it is in the loaded window. The list
   * scrolls to it and flashes it; it clears itself after `LOCATED_CLEAR_MS`.
   */
  located: { chatId: number; messageId: number } | null
  loadingOlder: boolean
  /**
   * Keep one page of older history in hand (`olderPagesByChat`) so the reader's
   * next scroll towards the top does not have to wait for TDLib. Idempotent and
   * fire-and-forget: it refuses to start twice, and a stale answer is dropped by
   * the store.
   */
  prefetchOlder: () => void
  /** The loaded window stops short of the newest message (anchored by a deep row). */
  hasNewer: boolean
  /** Empty-state "reload" button: re-runs the first-page fetch. */
  reload: () => void
  loadOlder: () => Promise<void>
  /** Extends an anchored window down; call it when the reader nears its end. */
  loadNewer: () => Promise<void>
}

/** What one first-page fetch produced, cached by react-query per chat. */
interface FirstPage {
  chatId: number
  messages: Message[]
  hasMore: boolean
  hasNewer: boolean
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
 *   3. if the landing row is older than that page, load a window *around it*,
 *   4. hand the page to the store, which replays any ops that arrived meanwhile.
 *
 * Step 3 used to page back from the newest message, six pages at a time. That
 * capped how deep a reading position could be (300 messages) and made the chat
 * open at the bottom once the budget ran out. A message at 5 000 messages up is
 * now one `messages:around` call away — but the window then does not reach the
 * newest message, which `hasNewer` carries to the list.
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
   * The unread snapshot `MainShell` took when the reader clicked the chat, before
   * any `messages:read` could move the marker. It is the only source of the read
   * boundary.
   */
  const marker = useAppStore.getState().unreadMarkers[chatId] ?? null
  /**
   * Where the first page has to reach back to. A chat opened with unread messages
   * needs the row the divider goes above; the newest page does not contain it once
   * the unread count passes the page size. `pickPagingTarget` also owns "does the
   * saved position outrank the divider" — the reader who left *after* the read
   * boundary must keep their row.
   */
  const locate = useAppStore.getState().locate
  const locating = locate !== null && locate.chatId === chatId ? locate.messageId : null
  const target: PagingTarget | null =
    locating !== null ? { kind: 'locate', messageId: locating } : pickPagingTarget(anchor, marker)

  const first = await invoke('messages:history', { chatId, limit: HISTORY_PAGE_SIZE })
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
  let hasNewer = false
  /** The around request itself failed (not "the row is gone"). */
  let aroundFailed = false
  const oldest = messages[0]
  if (target !== null && oldest !== undefined && oldest.id > target.messageId) {
    onRestoring()
    let around: { messages: Message[]; hasMore: boolean; hasNewer: boolean } | null = null
    try {
      around = await invoke('messages:around', {
        chatId,
        messageId: target.messageId,
        limit: AROUND_CONTEXT,
      })
    } catch (error) {
      // A failed window fetch must not blank the transcript: the newest page is
      // still a usable answer and the query keeps its retry for a cold fetch.
      if (signal.aborted) throw error
      around = null
      aroundFailed = true
    }
    signal.throwIfAborted()
    if (around !== null) {
      messages = around.messages
      hasMore = around.hasMore
      hasNewer = around.hasNewer
    }
  }

  // A located row outranks the saved position and the unread divider: the reader
  // asked for that message from the viewer, and that is where the chat opens.
  let landing = locateLanding(messages, locating) ?? resolveLanding(messages, marker, anchor)
  if (locating === null && target !== null && landing === null) {
    // The row we paged for is gone (deleted, or the window came back without it).
    // The newest page is the only honest fallback; opening on an arbitrary row
    // would be worse than opening at the bottom.
    messages = first.messages
    hasMore = first.hasMore
    hasNewer = false
    landing = resolveLanding(messages, marker, anchor)
  }
  signal.throwIfAborted()

  // Past this line the fetch is committed: an aborted query must not leave a page
  // in the store that nobody asked for any more.
  useAppStore.getState().setHistory(chatId, messages, hasMore, hasNewer)
  /**
   * A saved position we actually paged for and still could not reach (deleted):
   * drop it, so the next open stays instant instead of paging back again for
   * nothing. An anchor that lost to the unread divider is *not* dropped — it was
   * never the target, and it is still a valid place to return to once the chat has
   * no unread messages.
   */
  const anchorFound = anchor ? messages.some((message) => message.id === anchor.messageId) : false
  // A failed around request proves nothing about the row: keep the anchor so the
  // next open can try again. Only a window that came back without it (deleted)
  // justifies dropping the saved position.
  if (target?.kind === 'anchor' && !anchorFound && !aroundFailed) {
    void invoke('ui:saveAnchor', { chatId, messageId: null, offset: 0 }).catch(() => undefined)
  }

  return { chatId, messages, hasMore, hasNewer, landing }
}

/**
 * Owns the transcript's data lifecycle for the active chat: the first page, the
 * window around a deep landing row, and older/newer pages.
 *
 * React-query owns the request (key per chat, retries, cancellation, pending
 * flags); the store stays the single source of truth for the message list, so the
 * `evt:messages` stream keeps writing to one place. What this hook adds is the one
 * ordering rule react-query cannot know about: the landing position is resolved
 * *before* `anchorKnown` opens the mount gate.
 */
export function useChatHistory(activeChatId: number | null): ChatHistoryState {
  const [pendingLanding, setPendingLanding] = useState<PendingLanding | null>(null)
  /**
   * 定位到聊天位置. The first-page path above reaches the row while the chat is
   * opening; this covers the chat that is *already* open, where the row may sit
   * outside the loaded window (an anchored window, or a transcript left at the
   * bottom) and needs one `messages:around` before the list can scroll to it.
   */
  const [located, setLocated] = useState<{ chatId: number; messageId: number } | null>(null)
  const locate = useAppStore((state) => state.locate)
  /** The locate tick whose window fetch already came back without the row. */
  const locateFetched = useRef<number | null>(null)
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
  const hasNewer = useAppStore((state) =>
    activeChatId === null ? false : state.hasNewerByChat[activeChatId] === true,
  )
  /**
   * The located row may arrive with a page that keeps the row *count* unchanged (a
   * window loaded around it), so the effect below watches the array itself rather
   * than a length: `setHistory` replaces it, which is exactly when to look again.
   */
  const locatedMessages = useAppStore((state) =>
    activeChatId === null ? null : (state.messagesByChat[activeChatId] ?? null),
  )

  /**
   * 定位到聊天位置 on a conversation that is already open. Waiting for
   * `anchorKnown` keeps this off the first-page path (that one pages *around* the
   * row before mounting the list, so nothing is fetched twice).
   */
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

  /** The chat whose prefetch is in flight: one speculative request at a time. */
  const prefetchingChatRef = useRef<number | null>(null)

  /**
   * Fetch the page below the oldest loaded row *before* the reader asks for it.
   *
   * This is the one wait the transcript cannot otherwise hide: TDLib answers an
   * older page from its local cache or from the server, and the first server
   * answer was measured at ~3.4 s (`docs/HANDOFF.md`). A wheel gesture covers the
   * last screen in about a second, so a fetch started at the top always shows up
   * as a dead scroll — the "卡手" the reader reports. Keeping one page in hand
   * (`olderPagesByChat`) means `loadOlder` usually only has to prepend it.
   *
   * Failures and empty answers stay silent: this is speculative work, and the
   * real load reports its own error when the reader gets there.
   */
  const prefetchOlder = useCallback((): void => {
    const chatId = activeChatId
    if (chatId === null || prefetchingChatRef.current === chatId) return
    const store = useAppStore.getState()
    if (store.hasMoreByChat[chatId] !== true) return
    const oldest = (store.messagesByChat[chatId] ?? [])[0]
    if (!oldest) return
    const buffered = store.olderPagesByChat[chatId]
    // Warm already. (A page buffered below a row that is gone is not "warm":
    // the store refuses it on insert, so ask again here.)
    if (buffered !== undefined && buffered.afterId === oldest.id) return

    prefetchingChatRef.current = chatId
    void invoke('messages:history', {
      chatId,
      fromMessageId: oldest.id,
      limit: HISTORY_PAGE_SIZE,
    })
      .then((older) => {
        // Never buffer an empty page: a cold TDLib cache answers `[]`, and
        // inserting that would also report the wrong `hasMore`.
        if (older.messages.length === 0) return
        useAppStore.getState().bufferOlderPage(chatId, oldest.id, older.messages, older.hasMore)
      })
      .catch(() => undefined)
      .finally(() => {
        if (prefetchingChatRef.current === chatId) prefetchingChatRef.current = null
      })
  }, [activeChatId])

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
