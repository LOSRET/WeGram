import type { ChatSummary } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from './ipc'

/**
 * The same 260 ms the in-panel 查找聊天内容 view and 搜索群成员 pause for: long
 * enough that one typed word is one request, short enough to feel live.
 */
const SEARCH_DELAY_MS = 260

/** One screen of hits; the protocol caps a search page at 50 and the column needs fewer. */
const SEARCH_LIMIT = 20

export interface GlobalSearchState {
  /** Conversations matching the query, in the chat-list order TDLib answered with. */
  hits: ChatSummary[]
  loading: boolean
  error: string | null
}

/**
 * The chat list's global search (design doc §9.2): `search:global` → TDLib
 * `searchChats`, which matches titles and usernames over every chat the client
 * knows, not just the first `chats:list` page. The queries are debounced and
 * only the newest one may write state, exactly like the in-chat search view.
 */
export function useGlobalSearch(query: string): GlobalSearchState {
  const q = query.trim()
  const [state, setState] = useState<GlobalSearchState>({
    hits: [],
    loading: false,
    error: null,
  })
  /** Only the newest request may land; older ones are cancelled by the id check. */
  const requestRef = useRef(0)

  useEffect(() => {
    requestRef.current += 1
    const request = requestRef.current
    if (q === '') {
      setState({ hits: [], loading: false, error: null })
      return
    }
    // Drop the previous query's rows: showing them under a new needle makes the
    // emphasis lie about why they matched.
    setState({ hits: [], loading: true, error: null })
    const timer = window.setTimeout(() => {
      void invoke('search:global', { q, limit: SEARCH_LIMIT })
        .then((hits) => {
          if (request !== requestRef.current) return
          setState({ hits, loading: false, error: null })
        })
        .catch((cause: unknown) => {
          if (request !== requestRef.current) return
          setState({ hits: [], loading: false, error: errorMessage(cause) })
        })
    }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [q])

  return state
}
