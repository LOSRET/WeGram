import type { Virtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, type RefObject } from 'react'

import { readScrollPin } from '../../lib/scrollGeometry'
import { findRowElement } from './rowElement'
import { findRowIndex, type TranscriptRow } from './rows'
import { resyncScroller } from './scroller'
import type { ScrollFlags } from './scrollFlags'
import type { LandingPosition } from './unread'

interface UseInitialPositionParams {
  scrollRef: RefObject<HTMLDivElement | null>
  /** Transcript rows, not messages: an album is one row (design doc §8.6). */
  rows: TranscriptRow[]
  /** Where the chat opens: a saved row, the unread divider, or (null) the newest message. */
  landing: LandingPosition | null
  flags: ScrollFlags
  virtualizer: Virtualizer<HTMLDivElement, Element>
  ready: boolean
  markReady: () => void
  scrollToBottom: () => void
  unpin: () => void
  syncPin: () => void
}

/**
 * Distance from a message slot's top to the "以下是新消息" line drawn above it.
 *
 * The unread landing has to align the *line*, not the slot: aligning the slot puts
 * the line above the viewport edge, which is the one thing the reader is looking
 * for. Returns 0 when this slot carries no divider (it is not the unread row).
 */
function dividerOffset(slot: HTMLElement): number {
  const divider = slot.querySelector<HTMLElement>('.wx-unread-divider')
  if (!divider) return 0
  return divider.getBoundingClientRect().top - slot.getBoundingClientRect().top
}

/**
 * Where the transcript sits on its first paint: the saved reading position, the
 * unread divider, or the newest message.
 *
 * All of them happen while the list is still hidden (`wx-messages--pending`), so the
 * reader never sees it jump. Two things are load-bearing here and easy to undo:
 *
 *  1. The virtualizer measures rows lazily, so a single `scrollToIndex` is only an
 *     estimate; the position is corrected against the target row's DOM node until
 *     it stops moving — the same two-stage idea as the prepend compensation.
 *  2. Reveal must never hinge on animation frames alone. Chromium throttles rAF
 *     for an occluded window, and a list that stays hidden is indistinguishable
 *     from "messages did not load", so every frame-based path has a timer net.
 */
export function useInitialPosition({
  scrollRef,
  rows,
  landing,
  flags,
  virtualizer,
  ready,
  markReady,
  scrollToBottom,
  unpin,
  syncPin,
}: UseInitialPositionParams): void {
  const restoreTo = async (position: LandingPosition): Promise<void> => {
    const el = scrollRef.current
    if (!el) return
    flags.restoring.current = true
    unpin()
    const targetId = position.messageId
    /** The row that holds the target message, with the key its slot carries. */
    const findTarget = (): { index: number; key: string } | null => {
      const index = findRowIndex(rows, targetId)
      const row = rows[index]
      return index < 0 || !row ? null : { index, key: row.key }
    }
    /** Row offset to align to: the saved one, or the divider the row carries. */
    const offsetOf = (node: HTMLElement): number =>
      position.kind === 'unread' ? dividerOffset(node) : position.offset
    try {
      let target = findTarget()
      if (!target) return
      virtualizer.scrollToIndex(target.index, { align: 'start' })

      // Frame-bounded *and* time-bounded: an occluded window throttles rAF, and
      // a 40-frame loop can then take a minute.
      const deadline = Date.now() + 900
      let stable = 0
      for (let frame = 0; frame < 40 && stable < 2 && Date.now() < deadline; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        if (!scrollRef.current) return
        /**
         * Nothing to restore: the rows measured shorter than the viewport, so the
         * whole transcript is visible and the reader is looking at the newest
         * message. Correcting further cannot move `scrollTop`, and leaving the list
         * unpinned would raise the "↓ N 条新消息" buoy over a message the reader can
         * see. `finally` re-pins it. (Checked here and not before the first frame:
         * on mount the virtualizer has not seen its scroll element yet, so the
         * transcript reports as fitting even when it does not.)
         */
        if (readScrollPin(el).fits) break
        target = findTarget()
        if (!target) return
        const node = findRowElement(el, target.key)
        if (!node) {
          // Row is outside the rendered window (estimate was off): nudge again.
          virtualizer.scrollToIndex(target.index, { align: 'start' })
          stable = 0
          continue
        }
        const delta =
          node.getBoundingClientRect().top - el.getBoundingClientRect().top - offsetOf(node)
        if (Math.abs(delta) > 0.5) {
          el.scrollTop += delta
          stable = 0
          /**
           * Clamped at the end of the transcript. The unread block is shorter than
           * the viewport, so the divider cannot reach the top edge; without this
           * the loop keeps asking for a position the scroller does not have and the
           * list stays hidden until the deadline — the reader sees a blank pane for
           * up to 900 ms on every short unread block.
           */
          if (delta > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1) break
        } else {
          stable += 1
        }
      }
    } finally {
      flags.restoring.current = false
      // The corrections above wrote `scrollTop` directly; make sure the
      // virtualizer is painting the slice that is actually on screen.
      resyncScroller(el)
      // The synthetic scroll event only reaches the listener once it is attached,
      // and the geometry here is the settled one: re-derive the pin from it rather
      // than trusting an event. A transcript that measures shorter than the viewport
      // is at the bottom, and this is the only place that can notice it.
      syncPin()
    }
  }

  useLayoutEffect(() => {
    if (flags.initialised.current || rows.length === 0) return
    flags.initialised.current = true

    const position = landing
    if (position && findRowIndex(rows, position.messageId) >= 0) {
      void restoreTo(position).finally(markReady)
      // `restoreTo` walks frames with rAF, which Chromium throttles for an
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
  }, [rows.length])

  /**
   * Visibility must never hinge on layout timing. Whatever the positioning code
   * above does (restoring a deep anchor, waiting for frames), the transcript
   * becomes visible within a second of having messages.
   */
  useEffect(() => {
    if (ready || rows.length === 0) return
    const timer = window.setTimeout(markReady, 1000)
    return () => window.clearTimeout(timer)
  }, [ready, rows.length, markReady])
}
