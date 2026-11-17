import type { ScrollAnchor } from '@wechatgram/protocol'
import { useEffect, useRef, useState } from 'react'

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
  /** Empty-state "reload" button: re-runs the first-page fetch. */
  reload: () => void
  loadOlder: () => Promise<void>
}

/**
 * Owns the transcript's data lifecycle for the active chat: the first page, the
 * paging needed to reach a saved reading position, and older-page fetching.
 *
 * The order of the first-page flow is load-bearing:
 *   1. resolve the stored anchor (`ui:getAnchor`) — before mounting the list,
 *   2. fetch the first page, retrying while it comes back empty,
 *   3. page back up to a budget until the anchor message exists,
 *   4. hand the page to the store, which replays any ops that arrived meanwhile.
 */
export function useChatHistory(activeChatId: number | null): ChatHistoryState {
  const [pendingLanding, setPendingLanding] = useState<PendingLanding | null>(null)
  const [anchorKnown, setAnchorKnown] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  /**
   * The chat the two states above belong to.
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
  if (stateChatId !== activeChatId) {
    setStateChatId(activeChatId)
    setPendingLanding(null)
    setAnchorKnown(false)
  }

  useEffect(() => {
    if (!activeChatId) return
    let cancelled = false
    const store = useAppStore.getState()

    const resolveAnchor = async (): Promise<ScrollAnchor | null> =>
      invoke('ui:getAnchor', { chatId: activeChatId }).catch(() => null)

    /**
     * The unread snapshot `MainShell` took before `chats:open` reported the chat as
     * read. It is the only source of the read boundary, and it is per chat, so it is
     * read lazily instead of subscribed to.
     */
    const marker = () => useAppStore.getState().unreadMarkers[activeChatId] ?? null

    // Already in memory: no fetch, the list only needs the anchor to restore.
    // An *empty* entry is not treated as cached: it is what a cold TDLib cache
    // answers with while it has not loaded the chat's last message yet, and
    // trusting it left the transcript blank for the rest of the session.
    const cached = store.messagesByChat[activeChatId]
    if (cached && cached.length > 0) {
      setPendingLanding(null)
      setAnchorKnown(false)
      void resolveAnchor().then((anchor) => {
        if (cancelled) return
        // No fetch on this path, so the unread divider can only be honoured if its
        // row is already cached; otherwise `resolveLanding` falls back to the oldest
        // loaded row, which is the documented deep-unread behaviour.
        const landing = resolveLanding(cached, marker(), anchor)
        if (landing) setPendingLanding({ chatId: activeChatId, position: landing })
        setAnchorKnown(true)
      })
      return () => {
        cancelled = true
      }
    }

    setAnchorKnown(false)
    store.setLoadingHistory(activeChatId, true)

    /**
     * The chat list is the only place that knows whether the conversation has any
     * messages at all; `emptyPageIsHistory` owns the rule for using that knowledge.
     */
    const chatOfActive = () => useAppStore.getState().chats.find((item) => item.id === activeChatId)

    const loadFirstPage = async (): Promise<void> => {
      const anchor = await resolveAnchor()
      /**
       * Where the first page has to reach back to. A chat opened with unread
       * messages needs the row the divider goes above; the newest page does not
       * contain it once the unread count passes the page size. `pickPagingTarget`
       * also owns "does the saved position outrank the divider" — the reader who
       * left *after* the read boundary must keep their row.
       */
      const target = pickPagingTarget(anchor, marker())
      let first = await invoke('messages:history', { chatId: activeChatId, limit: PAGE_SIZE })
      // An empty first page means "TDLib has not got the chat's last message yet"
      // far more often than "this chat is empty": it happens right after a start,
      // while the local database is still syncing. Ask again before caching
      // nothing — a cached empty page is a blank transcript forever.
      for (
        let attempt = 0;
        attempt < EMPTY_PAGE_RETRIES && first.messages.length === 0;
        attempt += 1
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, EMPTY_PAGE_RETRY_DELAY_MS))
        if (cancelled) return
        first = await invoke('messages:history', { chatId: activeChatId, limit: PAGE_SIZE })
      }
      let messages = first.messages
      let hasMore = first.hasMore

      /**
       * The retries ran out and the answer is still empty although the chat list
       * says there are messages: do not hand that page to the store. Keeping the
       * entry absent is what makes the next open (or `重新加载`) ask again; caching
       * it is the "blank transcript for the rest of the session" bug. A genuinely
       * empty chat has no `lastMessageAt`, so its empty page is still cached and
       * still renders as "这个会话还没有可显示的消息".
       */
      if (messages.length === 0 && !emptyPageIsHistory(first, chatOfActive())) {
        // Also leave the reading position alone: the fetch never happened, so
        // there is nothing to learn about whether the anchor is reachable.
        return
      }

      const deadline = Date.now() + RESTORE_BUDGET_MS
      const oldest = messages[0]
      const needsPaging = target !== null && oldest !== undefined && oldest.id > target.messageId
      if (needsPaging && !cancelled) setRestoring(true)
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
          chatId: activeChatId,
          fromMessageId: from.id,
          limit: PAGE_SIZE,
        })
        messages = [...older.messages, ...messages]
        hasMore = older.hasMore
      }

      if (cancelled) return
      const landing = resolveLanding(messages, marker(), anchor)
      setPendingLanding(landing ? { chatId: activeChatId, position: landing } : null)
      useAppStore.getState().setHistory(activeChatId, messages, hasMore)
      /**
       * A saved position we actually paged for and still could not reach (deeper
       * than the budget, or deleted): drop it, so the next open stays instant
       * instead of paging back again for nothing. An anchor that lost to the unread
       * divider is *not* dropped — it was never the target, and it is still a valid
       * place to return to once the chat has no unread messages.
       */
      const anchorFound = anchor
        ? messages.some((message) => message.id === anchor.messageId)
        : false
      if (target?.kind === 'anchor' && !anchorFound) {
        void invoke('ui:saveAnchor', {
          chatId: activeChatId,
          messageId: null,
          offset: 0,
        }).catch(() => undefined)
      }
    }

    void (async () => {
      try {
        await loadFirstPage()
      } catch (error) {
        const message = errorMessage(error)
        if (!cancelled) {
          useAppStore.getState().setError(message)
          // One quiet retry: the proxy tunnel here flaps, and a failed first fetch
          // used to leave the pane empty forever — the only way back was toggling
          // the chat closed and open again.
          await new Promise((resolve) => window.setTimeout(resolve, FAILED_FETCH_RETRY_DELAY_MS))
          if (cancelled) return
          try {
            await loadFirstPage()
            if (useAppStore.getState().error === message) {
              useAppStore.getState().setError(null)
            }
          } catch {
            // The error bar stays; the user can close the chat and retry.
          }
        }
      } finally {
        if (!cancelled) {
          useAppStore.getState().setLoadingHistory(activeChatId, false)
          setRestoring(false)
          // Even on failure the list is mounted: it then falls back to the bottom.
          setAnchorKnown(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeChatId, reloadNonce])

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
  const messageCount = useAppStore((state) =>
    activeChatId === null ? 0 : (state.messagesByChat[activeChatId]?.length ?? 0),
  )
  const loading = useAppStore((state) =>
    activeChatId === null ? false : Boolean(state.loadingHistoryByChat[activeChatId]),
  )
  const hadRowsFor = useRef<number | null>(null)
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
    if (!anchorKnown || loading) return
    hadRowsFor.current = null
    setReloadNonce((value) => value + 1)
  }, [activeChatId, messageCount, anchorKnown, loading])

  const loadOlder = async (): Promise<void> => {
    if (!activeChatId) return
    const store = useAppStore.getState()
    const oldest = (store.messagesByChat[activeChatId] ?? [])[0]
    if (!oldest) return

    store.setLoadingOlder(activeChatId, true)
    try {
      const page = await invoke('messages:history', {
        chatId: activeChatId,
        fromMessageId: oldest.id,
        limit: PAGE_SIZE,
      })
      useAppStore.getState().prependHistory(activeChatId, page.messages, page.hasMore)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      useAppStore.getState().setLoadingOlder(activeChatId, false)
    }
  }

  return {
    pendingLanding,
    anchorKnown,
    restoring,
    reload: () => setReloadNonce((value) => value + 1),
    loadOlder,
  }
}
