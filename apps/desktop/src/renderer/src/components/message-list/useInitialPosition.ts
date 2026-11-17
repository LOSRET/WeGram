import type { Virtualizer } from '@tanstack/react-virtual'
import type { Message } from '@wechatgram/protocol'
import { useEffect, useLayoutEffect, type RefObject } from 'react'

import { resyncScroller } from './scroller'
import type { ScrollFlags } from './scrollFlags'

interface UseInitialPositionParams {
  scrollRef: RefObject<HTMLDivElement | null>
  messages: Message[]
  /** Saved reading position to open the chat at; null means "land at the bottom". */
  initialAnchor: { messageId: number; offset: number } | null
  flags: ScrollFlags
  virtualizer: Virtualizer<HTMLDivElement, Element>
  ready: boolean
  markReady: () => void
  scrollToBottom: () => void
  unpin: () => void
}

/**
 * Where the transcript sits on its first paint: the saved reading position, or
 * the newest message.
 *
 * Both happen while the list is still hidden (`wx-messages--pending`), so the
 * reader never sees it jump. Two things are load-bearing here and easy to undo:
 *
 *  1. The virtualizer measures rows lazily, so a single `scrollToIndex` is only an
 *     estimate; the position is corrected against the anchor row's DOM node until
 *     it stops moving — the same two-stage idea as the prepend compensation.
 *  2. Reveal must never hinge on animation frames alone. Chromium throttles rAF
 *     for an occluded window, and a list that stays hidden is indistinguishable
 *     from "messages did not load", so every frame-based path has a timer net.
 */
export function useInitialPosition({
  scrollRef,
  messages,
  initialAnchor,
  flags,
  virtualizer,
  ready,
  markReady,
  scrollToBottom,
  unpin,
}: UseInitialPositionParams): void {
  const restoreToAnchor = async (messageId: number, offset: number): Promise<void> => {
    const el = scrollRef.current
    if (!el) return
    flags.restoring.current = true
    unpin()
    try {
      let index = messages.findIndex((message) => message.id === messageId)
      if (index < 0) return
      virtualizer.scrollToIndex(index, { align: 'start' })

      // Frame-bounded *and* time-bounded: an occluded window throttles rAF, and
      // a 40-frame loop can then take a minute.
      const deadline = Date.now() + 900
      let stable = 0
      for (let frame = 0; frame < 40 && stable < 2 && Date.now() < deadline; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        if (!scrollRef.current) return
        index = messages.findIndex((message) => message.id === messageId)
        if (index < 0) return
        const node = el.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
        if (!node) {
          // Row is outside the rendered window (estimate was off): nudge again.
          virtualizer.scrollToIndex(index, { align: 'start' })
          stable = 0
          continue
        }
        const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top - offset
        if (Math.abs(delta) > 0.5) {
          el.scrollTop += delta
          stable = 0
        } else {
          stable += 1
        }
      }
    } finally {
      flags.restoring.current = false
      // The corrections above wrote `scrollTop` directly; make sure the
      // virtualizer is painting the slice that is actually on screen.
      resyncScroller(el)
    }
  }

  useLayoutEffect(() => {
    if (flags.initialised.current || messages.length === 0) return
    flags.initialised.current = true

    const anchor = initialAnchor
    if (anchor && messages.some((message) => message.id === anchor.messageId)) {
      void restoreToAnchor(anchor.messageId, anchor.offset).finally(markReady)
      // `restoreToAnchor` walks frames with rAF, which Chromium throttles for an
      // occluded window — without this the list would stay invisible (the
      // `--pending` gate) for as long as that lasts.
      window.setTimeout(markReady, 700)
      return
    }

    /**
     * Land on the newest message with the virtualizer and the element agreeing on
     * the offset. Rows are positioned from the virtualizer's *own* `scrollOffset`,
     * which is only refreshed by real scroll events: a bare `scrollTop` write
     * lands before the virtualizer's listener exists, so it kept rendering from
     * the top of the history while the element sat at the bottom.
     */
    const stickToNewest = (): void => {
      virtualizer.scrollToEnd()
      scrollToBottom()
      resyncScroller(scrollRef.current)
    }

    /** Re-stick only while the reader is still at the bottom. */
    const restickIfAtBottom = (): void => {
      const el = scrollRef.current
      if (!el) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 40) return
      stickToNewest()
    }

    stickToNewest()
    // Open the ready gate on the next frame, but never depend on it alone. No
    // cleanup cancels these: StrictMode runs mount effects twice and its cleanup
    // would kill the frame scheduled by the pass that actually initialised the
    // list.
    let opened = false
    const finish = (): void => {
      if (opened) return
      opened = true
      stickToNewest()
      markReady()
    }
    requestAnimationFrame(finish)
    window.setTimeout(finish, 150)
    // Row heights are only measured after the first paint, and the initial
    // `scrollToEnd` was computed from estimates: settle once the measurements
    // have landed (still idempotent when the reader stays put).
    window.setTimeout(restickIfAtBottom, 150)
    window.setTimeout(restickIfAtBottom, 400)
    // Runs once per mounted chat (the list is keyed by chat id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

  /**
   * Visibility must never hinge on layout timing. Whatever the positioning code
   * above does (restoring a deep anchor, waiting for frames), the transcript
   * becomes visible within a second of having messages.
   */
  useEffect(() => {
    if (ready || messages.length === 0) return
    const timer = window.setTimeout(markReady, 1000)
    return () => window.clearTimeout(timer)
  }, [ready, messages.length, markReady])
}
