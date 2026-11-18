import type { Message } from '@wegram/protocol'
import { useCallback, useEffect, type RefObject } from 'react'

import { findRowElement } from './rowElement'
import { resyncScroller } from './scroller'
import type { ScrollFlags } from './scrollFlags'

/**
 * A history request that never settles (the proxy tunnel here flaps) used to keep
 * the loading/prepending flags set for the rest of the session, which blocked
 * every later page *and* every later position save. Cap the wait.
 */
const LOAD_OLDER_TIMEOUT_MS = 15_000

interface UsePrependRestoreParams {
  scrollRef: RefObject<HTMLDivElement | null>
  messages: Message[]
  hasMore: boolean
  ready: boolean
  flags: ScrollFlags
  onLoadOlder: () => Promise<void>
}

/**
 * Rule 2 of the transcript: when older messages are prepended, the row the reader
 * is looking at must stay under the same pixel.
 *
 * Two stages, in this order:
 *  1. rough compensation by height delta, repeated for a few frames — the
 *     virtualizer remeasures prepended rows over time, so one pass is not enough
 *     to bring the anchor row back into the rendered window;
 *  2. exact correction against the anchor row's DOM offset, until stable.
 *
 * Stage 2 alone cannot work: right after a prepend the anchor row is outside the
 * virtualizer's rendered window, so it has no DOM node to measure.
 */
export function usePrependRestore({
  scrollRef,
  messages,
  hasMore,
  ready,
  flags,
  onLoadOlder,
}: UsePrependRestoreParams): { loadOlder: () => Promise<void> } {
  const captureSnapshot = (): { scrollHeight: number; scrollTop: number } | null => {
    const el = scrollRef.current
    return el ? { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop } : null
  }

  /**
   * The row key, not a message id: an album that grows by one item after a page
   * arrives keeps its key but not its first message id, and a message anchor would
   * then point at a node that no longer exists.
   */
  const captureAnchor = (): { key: string; offset: number } | null => {
    const el = scrollRef.current
    if (!el) return null
    const containerTop = el.getBoundingClientRect().top
    const slot = [...el.querySelectorAll<HTMLElement>('.wx-message-slot')].find(
      (node) => node.getBoundingClientRect().top >= containerTop + 8,
    )
    const key = slot?.dataset['rowKey']
    if (!slot || !key) return null
    return { key, offset: slot.getBoundingClientRect().top - containerTop }
  }

  const restorePosition = async (
    snapshot: { scrollHeight: number; scrollTop: number },
    anchor: { key: string; offset: number } | null,
  ): Promise<void> => {
    const el = scrollRef.current
    if (!el) return

    // These `scrollTop` writes are ours, not the reader's: the position they
    // produce is a transient one, so keep it out of the saved anchor.
    flags.programmatic.current = true
    try {
      for (let frame = 0; frame < 8; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const target = snapshot.scrollTop + (el.scrollHeight - snapshot.scrollHeight)
        if (Math.abs(target - el.scrollTop) > 0.5) el.scrollTop = target
      }

      if (!anchor) return
      let stable = 0
      for (let frame = 0; frame < 30 && stable < 2; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const node = findRowElement(el, anchor.key)
        if (!node) {
          stable = 0
          continue
        }
        const offset = node.getBoundingClientRect().top - el.getBoundingClientRect().top
        const delta = offset - anchor.offset
        if (Math.abs(delta) > 0.5) {
          el.scrollTop += delta
          stable = 0
        } else {
          stable += 1
        }
      }

      // Report the outcome for the dev acceptance panel (PerfPanel) and for
      // debugging: how far the anchored row ended up from where it started.
      const finalNode = findRowElement(el, anchor.key)
      const finalOffset = finalNode
        ? finalNode.getBoundingClientRect().top - el.getBoundingClientRect().top
        : Number.NaN
      el.dataset['anchorId'] = anchor.key
      el.dataset['anchorVisible'] = finalNode ? '1' : '0'
      el.dataset['anchorDelta'] = Number.isFinite(finalOffset)
        ? (finalOffset - anchor.offset).toFixed(1)
        : 'NaN'
    } finally {
      flags.programmatic.current = false
      // The compensation wrote `scrollTop` directly.
      resyncScroller(el)
    }
  }

  const loadOlder = useCallback(async (): Promise<void> => {
    if (flags.prepending.current || !hasMore) return
    flags.prepending.current = true
    const snapshot = captureSnapshot()
    const anchor = captureAnchor()
    try {
      // Settle even if the IPC call never answers — see LOAD_OLDER_TIMEOUT_MS.
      await Promise.race([
        onLoadOlder(),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, LOAD_OLDER_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (snapshot) await restorePosition(snapshot, anchor)
      window.setTimeout(() => {
        flags.prepending.current = false
      }, 200)
    }
    // captureSnapshot/captureAnchor/restorePosition read the live DOM and the ref
    // flags, so they need no dependency entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags.prepending, hasMore, onLoadOlder])

  /**
   * A page can come back shorter than the viewport (TDLib likes to answer a
   * history request from its local window first). With nothing to scroll, the
   * `onScroll` handler never runs, so the reader would be stuck on a handful of
   * messages with no way to ask for more. Fill the view instead.
   */
  useEffect(() => {
    if (!ready || !hasMore) return
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight <= el.clientHeight + 8) void loadOlder()
    // Runs on every page; loadOlder itself is guarded against re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hasMore, messages.length])

  return { loadOlder }
}
