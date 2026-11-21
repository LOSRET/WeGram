import type { SearchMessagesCursor } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from './ipc'
import {
  cursorHasMore,
  mergeHits,
  pageHits,
  SEARCH_SCOPES,
  type MessageHit,
  type SearchScope,
} from './messageSearch'

/** One screen of hits per scope; the panel loads the next page on scroll. */
const PAGE_LIMIT = 20
/** The same 260 ms every search surface in the app pauses for. */
const SEARCH_DELAY_MS = 260

export interface MessageSearchScopeState {
  hits: MessageHit[]
  /** TDLib's approximate total for this scope, printed as 找到 N 条消息. */
  total: number
  /** Null before the first answer; empty offsets mean the scope is exhausted. */
  cursor: SearchMessagesCursor | null
  loading: boolean
  loadingMore: boolean
  error: string | null
}

function emptyScope(loading = false): MessageSearchScopeState {
  return { hits: [], total: 0, cursor: null, loading, loadingMore: false, error: null }
}

export interface MessageSearchState {
  scopes: Record<SearchScope, MessageSearchScopeState>
  loadMore: (scope: SearchScope) => void
}

function emptyState(loading = false): Record<SearchScope, MessageSearchScopeState> {
  return {
    chat: emptyScope(loading),
    channel: emptyScope(loading),
  }
}

/**
 * Cross-chat message search (design doc §9.2). Both scopes are fetched for one
 * query so the panel's 聊天 / 频道 tabs switch without another round trip; the
 * newest request owns the state, and a page is appended when the reader reaches
 * the end of the results.
 */
export function useMessageSearch(query: string): MessageSearchState {
  const q = query.trim()
  const [scopes, setScopes] = useState<Record<SearchScope, MessageSearchScopeState>>(emptyState())
  /** Only the newest query may land; older answers are dropped by id. */
  const requestRef = useRef(0)
  /** The scroll handler calls loadMore outside React's render flow. */
  const scopesRef = useRef(scopes)
  scopesRef.current = scopes

  useEffect(() => {
    requestRef.current += 1
    const request = requestRef.current
    if (q === '') {
      setScopes(emptyState())
      return
    }
    setScopes(emptyState(true))
    const timer = window.setTimeout(() => {
      for (const scope of SEARCH_SCOPES) {
        void invoke('search:messages', { q, scope, limit: PAGE_LIMIT })
          .then((page) => {
            if (request !== requestRef.current) return
            setScopes((current) => ({
              ...current,
              [scope]: {
                hits: pageHits(page.messages, page.chats),
                total: page.total,
                cursor: page.cursor,
                loading: false,
                loadingMore: false,
                error: null,
              },
            }))
          })
          .catch((cause: unknown) => {
            if (request !== requestRef.current) return
            setScopes((current) => ({
              ...current,
              [scope]: { ...emptyScope(), error: errorMessage(cause) },
            }))
          })
      }
    }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [q])

  const loadMore = useCallback(
    (scope: SearchScope) => {
      const state = scopesRef.current[scope]
      if (state.loading || state.loadingMore || state.error !== null) return
      const cursor = state.cursor
      if (cursor === null || !cursorHasMore(cursor)) return
      const request = requestRef.current
      setScopes((current) => ({
        ...current,
        [scope]: { ...current[scope], loadingMore: true },
      }))
      void invoke('search:messages', { q, scope, limit: PAGE_LIMIT, cursor })
        .then((page) => {
          if (request !== requestRef.current) return
          setScopes((current) => {
            const previous = current[scope]
            return {
              ...current,
              [scope]: {
                ...previous,
                hits: mergeHits(previous.hits, pageHits(page.messages, page.chats)),
                total: page.total,
                cursor: page.cursor,
                loadingMore: false,
              },
            }
          })
        })
        .catch((cause: unknown) => {
          if (request !== requestRef.current) return
          setScopes((current) => ({
            ...current,
            [scope]: { ...current[scope], loadingMore: false, error: errorMessage(cause) },
          }))
        })
    },
    [q],
  )

  return { scopes, loadMore }
}
