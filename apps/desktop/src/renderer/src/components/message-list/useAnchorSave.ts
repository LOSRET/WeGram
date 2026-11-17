import { useCallback, useEffect, useRef, type RefObject } from 'react'

import { invoke } from '../../lib/ipc'
import { readScrollPin } from '../../lib/scrollGeometry'
import type { ScrollFlags } from './scrollFlags'

/** Saved reading position: `messageId: null` means "the reader was at the bottom". */
type Anchor = { messageId: number | null; offset: number }

/**
 * Gap between reading-position writes during one scroll burst. The first scroll
 * of a burst is written immediately; later ones are collapsed into one trailing
 * write, so a reader who leaves right away still leaves a recorded position.
 */
const ANCHOR_SAVE_DELAY_MS = 250

interface UseAnchorSaveParams {
  chatId: number
  scrollRef: RefObject<HTMLDivElement | null>
  flags: ScrollFlags
}

/**
 * Persists where the reader stopped (`ui:saveAnchor` → `ui.db`), so reopening the
 * chat restores the row.
 *
 * The two mistakes to avoid here, both already made once:
 *   - measuring *inside* the debounce (or in the unmount cleanup). By then the
 *     rows may be re-laid out and React has nulled `scrollRef.current`, so it
 *     measures nothing and the save is silently lost. The last measurement is
 *     therefore kept in `latestAnchorRef` and written without touching the DOM.
 *   - suppressing the save whenever a history page was in flight. Paging up is
 *     the common case while reading, so that dropped most saves. Only our own
 *     programmatic moves (`restoring`/`programmatic`) suppress it now.
 */
export function useAnchorSave({ chatId, scrollRef, flags }: UseAnchorSaveParams): {
  scheduleAnchorSave: () => void
  /** Write a known position immediately — for landings the geometry cannot measure. */
  savePosition: (anchor: Anchor) => void
} {
  const lastSavedKeyRef = useRef('')
  const latestAnchorRef = useRef<Anchor | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const lastWriteAtRef = useRef(0)

  const measureAnchor = useCallback((): Anchor | null => {
    const el = scrollRef.current
    if (!el) return null
    // At (or within a hair of) the bottom: no anchor at all is the two-in-one
    // "read to the end" flag — reopening lands on the newest message. The rule is
    // shared with the pin state (`lib/scrollGeometry`) so the two cannot drift.
    if (readScrollPin(el).pinned) return { messageId: null, offset: 0 }
    const containerTop = el.getBoundingClientRect().top
    const slot = [...el.querySelectorAll<HTMLElement>('.wx-message-slot')].find(
      (node) => node.getBoundingClientRect().bottom > containerTop + 4,
    )
    const id = slot?.dataset['messageId']
    if (!slot || !id) return null
    return {
      messageId: Number(id),
      offset: Math.round(slot.getBoundingClientRect().top - containerTop),
    }
  }, [scrollRef])

  const writeAnchor = useCallback(
    (anchor: Anchor): void => {
      const key = `${anchor.messageId ?? 'bottom'}:${anchor.offset}`
      if (key === lastSavedKeyRef.current) return
      lastSavedKeyRef.current = key
      void invoke('ui:saveAnchor', {
        chatId,
        messageId: anchor.messageId,
        offset: anchor.offset,
      }).catch(() => undefined)
    },
    [chatId],
  )

  const scheduleAnchorSave = useCallback((): void => {
    if (!flags.initialised.current || flags.restoring.current || flags.programmatic.current) return
    const anchor = measureAnchor()
    if (!anchor) return
    latestAnchorRef.current = anchor
    const now = Date.now()
    if (now - lastWriteAtRef.current >= ANCHOR_SAVE_DELAY_MS) {
      lastWriteAtRef.current = now
      writeAnchor(anchor)
      return
    }
    if (saveTimerRef.current !== null) return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      lastWriteAtRef.current = Date.now()
      const pending = latestAnchorRef.current
      if (pending) writeAnchor(pending)
    }, ANCHOR_SAVE_DELAY_MS)
  }, [flags, measureAnchor, writeAnchor])

  /**
   * Opening at the unread divider is a reading position the DOM does not express:
   * the divider is only painted for this open, so measuring it would store a row
   * offset that reopens as an empty band where the line used to be. The caller
   * knows the row and the intent, so it writes them directly.
   */
  const savePosition = useCallback(
    (anchor: Anchor): void => {
      latestAnchorRef.current = anchor
      writeAnchor(anchor)
    },
    [writeAnchor],
  )

  // Leaving the chat (or quitting): write whatever the last scroll measured.
  // Deliberately does not re-measure — see the note above.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      const pending = latestAnchorRef.current
      if (pending) writeAnchor(pending)
    }
    // Runs once per mounted chat (the list is keyed by chat id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { scheduleAnchorSave, savePosition }
}
