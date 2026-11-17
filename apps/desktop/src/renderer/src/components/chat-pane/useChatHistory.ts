import type { ScrollAnchor } from '@wechatgram/protocol'
import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'

/** How many extra pages may be fetched to reach a saved reading position. */
const MAX_RESTORE_PAGES = 6
/** Give up paging back (and land at the bottom) after this long. */
const RESTORE_BUDGET_MS = 10_000
/** Page size for the first page and for every "older" page. */
const PAGE_SIZE = 50
/** An empty first page is usually a cold TDLib cache: ask again before caching it. */
const EMPTY_PAGE_RETRIES = 3
const EMPTY_PAGE_RETRY_DELAY_MS = 800
/** One quiet retry after a failed first fetch (the proxy tunnel here flaps). */
const FAILED_FETCH_RETRY_DELAY_MS = 1500

export interface PendingAnchor {
  chatId: number
  messageId: number
  offset: number
}

export interface ChatHistoryState {
  /** Reading position to open this chat at (#2); null → land at the bottom. */
  pendingAnchor: PendingAnchor | null
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
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null)
  const [anchorKnown, setAnchorKnown] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    if (!activeChatId) return
    let cancelled = false
    const store = useAppStore.getState()

    const resolveAnchor = async (): Promise<ScrollAnchor | null> =>
      invoke('ui:getAnchor', { chatId: activeChatId }).catch(() => null)

    // Already in memory: no fetch, the list only needs the anchor to restore.
    // An *empty* entry is not treated as cached: it is what a cold TDLib cache
    // answers with while it has not loaded the chat's last message yet, and
    // trusting it left the transcript blank for the rest of the session.
    const cached = store.messagesByChat[activeChatId]
    if (cached && cached.length > 0) {
      setPendingAnchor(null)
      setAnchorKnown(false)
      void resolveAnchor().then((anchor) => {
        if (cancelled) return
        if (anchor && cached.some((message) => message.id === anchor.messageId)) {
          setPendingAnchor({ chatId: activeChatId, ...anchor })
        }
        setAnchorKnown(true)
      })
      return () => {
        cancelled = true
      }
    }

    setAnchorKnown(false)
    store.setLoadingHistory(activeChatId, true)

    const loadFirstPage = async (): Promise<void> => {
      const anchor = await resolveAnchor()
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

      const deadline = Date.now() + RESTORE_BUDGET_MS
      const needsPaging =
        Boolean(anchor) && messages.length > 0 && messages[0]!.id > anchor!.messageId
      if (needsPaging && !cancelled) setRestoring(true)
      for (
        let pages = 0;
        anchor &&
        hasMore &&
        messages.length > 0 &&
        messages[0]!.id > anchor.messageId &&
        pages < MAX_RESTORE_PAGES &&
        Date.now() < deadline;
        pages += 1
      ) {
        const older = await invoke('messages:history', {
          chatId: activeChatId,
          fromMessageId: messages[0]!.id,
          limit: PAGE_SIZE,
        })
        messages = [...older.messages, ...messages]
        hasMore = older.hasMore
      }

      if (cancelled) return
      const found = anchor ? messages.some((message) => message.id === anchor.messageId) : false
      setPendingAnchor(found && anchor ? { chatId: activeChatId, ...anchor } : null)
      useAppStore.getState().setHistory(activeChatId, messages, hasMore)
      // The position could not be reached within the budget (deep history): land
      // at the bottom and drop the anchor, so the next open stays instant instead
      // of paging back again for nothing.
      if (anchor && !found) {
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
    pendingAnchor,
    anchorKnown,
    restoring,
    reload: () => setReloadNonce((value) => value + 1),
    loadOlder,
  }
}
