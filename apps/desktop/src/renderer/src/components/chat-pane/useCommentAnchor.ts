import type { ScrollAnchor } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { invoke } from '../../lib/ipc'

/**
 * Gap between reading-position writes during one scroll burst, the same rhythm as
 * the transcript's `useAnchorSave` (first scroll written at once, the rest of the
 * burst collapsed into one trailing write).
 */
const SAVE_DELAY_MS = 250

interface UseCommentAnchorParams {
  chatId: number
  /** The commented message: with the chat it names exactly one thread. */
  messageId: number
  /** The panel's scroller. */
  scrollRef: RefObject<HTMLDivElement | null>
  /** The list inside it; every comment row carries `data-message-id`. */
  listRef: RefObject<HTMLDivElement | null>
}

interface AnchorState {
  key: string
  anchor: ScrollAnchor | null
  known: boolean
}

/**
 * The reading position of one comment thread (design doc §9.8), stored in `ui.db`
 * like a chat's (§8.2 rule 5) and restored when the discussion view reopens.
 *
 * Two things differ from the transcript's anchor:
 *  - the default landing is the top of the thread, not its newest comment, so "no
 *    stored row" means "open at the top" and needs no bottom sentinel;
 *  - the rows are not virtualised, so the position is measured off the rendered
 *    `data-message-id` slots instead of the virtualiser's measurements.
 *
 * `anchorKnown` opens the gate for the first positioning pass: the stored row must
 * beat the default top, exactly as `useChatHistory` does for a chat.
 */
export function useCommentAnchor({
  chatId,
  messageId,
  scrollRef,
  listRef,
}: UseCommentAnchorParams): {
  anchor: ScrollAnchor | null
  anchorKnown: boolean
  scheduleSave: () => void
} {
  const key = `${chatId}:${messageId}`
  const [state, setState] = useState<AnchorState>({ key, anchor: null, known: false })
  /**
   * Reset during render, not in an effect: an effect runs after a render that still
   * carries the previous thread's anchor, and that frame could save the old
   * position into the new thread (the same trap that made every cached chat reopen
   * at the bottom, see `useChatHistory`).
   */
  if (state.key !== key) setState({ key, anchor: null, known: false })

  useEffect(() => {
    let cancelled = false
    void invoke('ui:getCommentAnchor', { chatId, messageId })
      .catch(() => null)
      .then((anchor) => {
        if (cancelled) return
        setState((current) => (current.key === key ? { key, anchor, known: true } : current))
      })
    return () => {
      cancelled = true
    }
  }, [chatId, messageId, key])

  const latestRef = useRef<ScrollAnchor | null>(null)
  const timerRef = useRef<number | null>(null)
  const lastWriteAtRef = useRef(0)

  /** A scroll measured for the previous thread must not be written under this one. */
  useEffect(() => {
    latestRef.current = null
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [key])

  const write = useCallback(
    (anchor: ScrollAnchor): void => {
      void invoke('ui:saveCommentAnchor', {
        chatId,
        messageId,
        anchorMessageId: anchor.messageId,
        offset: anchor.offset,
      }).catch(() => undefined)
    },
    [chatId, messageId],
  )

  const measure = useCallback((): ScrollAnchor | null => {
    const el = scrollRef.current
    const list = listRef.current
    if (!el || !list) return null
    const containerTop = el.getBoundingClientRect().top
    const row = [...list.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (node) => node.getBoundingClientRect().bottom > containerTop + 4,
    )
    const id = row?.dataset['messageId']
    if (!row || !id) return null
    return {
      messageId: Number(id),
      offset: Math.round(row.getBoundingClientRect().top - containerTop),
    }
  }, [listRef, scrollRef])

  const scheduleSave = useCallback((): void => {
    // Before the gate opens the list sits at the top by construction; writing that
    // would overwrite the row this open is about to restore.
    if (!state.known) return
    const anchor = measure()
    if (anchor === null) return
    latestRef.current = anchor
    const now = Date.now()
    if (now - lastWriteAtRef.current >= SAVE_DELAY_MS) {
      lastWriteAtRef.current = now
      write(anchor)
      return
    }
    if (timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      lastWriteAtRef.current = Date.now()
      const pending = latestRef.current
      if (pending !== null) write(pending)
    }, SAVE_DELAY_MS)
  }, [measure, state.known, write])

  // Closing the panel keeps the last measured row, without re-measuring: the rows
  // are already being torn down by the time cleanup runs.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const pending = latestRef.current
      if (pending !== null) write(pending)
    }
    // Once per mounted panel; the id pair is captured by `write`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { anchor: state.anchor, anchorKnown: state.known, scheduleSave }
}
