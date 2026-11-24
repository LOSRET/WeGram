import type { InlineQueryAnswer, InlineResult } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { InlineQueryDraft } from './inlineQuery'
import { invoke } from './ipc'

/** One request per pause, like the search box's 260 ms. */
const INLINE_DEBOUNCE_MS = 250

/** What the inline panel draws: the bot's rows and the state of the ask. */
export interface InlineQueryState {
  /** The rows answered so far, first page first. */
  results: InlineResult[]
  /** The query id the newest page belongs to; a send posts it back. */
  queryId: string
  /** Cursor for the next page; empty means "no more results". */
  nextOffset: string
  loading: boolean
  /** The bot did not answer (TDLib's 502, or the handle is gone). */
  failed: boolean
}

const EMPTY: InlineQueryState = {
  results: [],
  queryId: '',
  nextOffset: '',
  loading: false,
  failed: false,
}

/**
 * inline 机器人's results (§8.3): the text after @bot, asked of the bot once the
 * reader pauses.
 *
 * The request is keyed by chat + handle + text and guarded by a sequence number:
 * a bot that answers the previous keystroke after the next one was asked must not
 * paint over the newer list. A failed ask is a state, not an error bar — a bot may
 * be offline, and the reader is still typing a message that can just be sent.
 */
export function useInlineQuery(
  chatId: number,
  draft: InlineQueryDraft | null,
): { state: InlineQueryState; loadMore: () => void } {
  const [state, setState] = useState<InlineQueryState>(EMPTY)
  /** Bumped per query, so a stale answer (or a stale page) cannot land. */
  const seq = useRef(0)
  const active = draft !== null
  const username = draft?.username ?? ''
  const query = draft?.query ?? ''

  useEffect(() => {
    seq.current += 1
    const ticket = seq.current
    if (!active) {
      setState(EMPTY)
      return
    }
    // A new query starts empty: the previous bot's rows under the new handle
    // would be a lie, and 加载更多 must not append to them.
    setState({ ...EMPTY, loading: true })
    const timer = window.setTimeout(() => {
      void invoke('bots:inlineQuery', { chatId, username, query })
        .then((answer) => {
          if (ticket !== seq.current) return
          setState({ ...rowsOf(answer), loading: false, failed: false })
        })
        .catch(() => {
          if (ticket !== seq.current) return
          setState({ ...EMPTY, failed: true })
        })
    }, INLINE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [active, chatId, username, query])

  /** The next chunk, appended; the newest answer's query id is the one sent with. */
  const loadMore = useCallback((): void => {
    if (!active || !state.nextOffset) return
    const ticket = seq.current
    setState((current) => ({ ...current, loading: true }))
    void invoke('bots:inlineQuery', { chatId, username, query, offset: state.nextOffset })
      .then((answer) => {
        if (ticket !== seq.current) return
        setState((current) => ({
          results: [...current.results, ...answer.results],
          queryId: answer.queryId || current.queryId,
          nextOffset: answer.nextOffset,
          loading: false,
          failed: false,
        }))
      })
      .catch(() => {
        if (ticket !== seq.current) return
        setState((current) => ({ ...current, loading: false }))
      })
  }, [active, chatId, query, state.nextOffset, username])

  return { state, loadMore }
}

function rowsOf(
  answer: InlineQueryAnswer,
): Pick<InlineQueryState, 'results' | 'queryId' | 'nextOffset'> {
  return {
    results: answer.results,
    queryId: answer.queryId,
    nextOffset: answer.nextOffset,
  }
}
