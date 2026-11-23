import type { Message } from '@wegram/protocol'

import { HISTORY_PAGE_SIZE, emptyPageIsHistory } from '../../../lib/history'
import { invoke } from '../../../lib/ipc'
import { useAppStore } from '../../../store/useAppStore'
import {
  locateLanding,
  pickPagingTarget,
  resolveLanding,
  type PagingTarget,
} from '../../message-list/unread'
import { AROUND_CONTEXT, ColdCacheError, type FirstPage } from './types'

/**
 * The whole first-page flow, in the order it has to happen:
 *   1. resolve the stored anchor (`ui:getAnchor`) — before the list may mount,
 *   2. fetch the first page (an empty answer the chat list contradicts throws),
 *   3. if the landing row is older than that page, load a window *around it*,
 *   4. hand the page to the store, which replays any ops that arrived meanwhile.
 *
 * Step 3 used to page back from the newest message, six pages at a time. That
 * capped how deep a reading position could be (300 messages) and made the chat
 * open at the bottom once the budget ran out. A message at 5 000 messages up is
 * now one `messages:around` call away — but the window then does not reach the
 * newest message, which `hasNewer` carries to the list.
 *
 * It runs inside the query function, so react-query owns retries, cancellation and
 * the pending flags instead of a hand-written state machine.
 */
export async function readFirstPage(
  chatId: number,
  signal: AbortSignal,
  onRestoring: () => void,
): Promise<FirstPage> {
  const anchor = await invoke('ui:getAnchor', { chatId }).catch(() => null)
  signal.throwIfAborted()

  /**
   * The unread snapshot `MainShell` took when the reader clicked the chat, before
   * any `messages:read` could move the marker. It is the only source of the read
   * boundary.
   */
  const marker = useAppStore.getState().unreadMarkers[chatId] ?? null
  /**
   * Where the first page has to reach back to. A chat opened with unread messages
   * needs the row the divider goes above; the newest page does not contain it once
   * the unread count passes the page size. `pickPagingTarget` also owns "does the
   * saved position outrank the divider" — the reader who left *after* the read
   * boundary must keep their row.
   */
  const locate = useAppStore.getState().locate
  const locating = locate !== null && locate.chatId === chatId ? locate.messageId : null
  const target: PagingTarget | null =
    locating !== null ? { kind: 'locate', messageId: locating } : pickPagingTarget(anchor, marker)

  const first = await invoke('messages:history', { chatId, limit: HISTORY_PAGE_SIZE })
  signal.throwIfAborted()

  /**
   * The chat list is the only place that knows whether the conversation has any
   * messages at all; `emptyPageIsHistory` owns the rule for using that knowledge.
   * A genuinely empty chat has no `lastMessageAt`, so its empty page is still real.
   */
  // Either list: an archived chat's first page follows the same empty-page rule.
  const state = useAppStore.getState()
  const chat = [...state.chats, ...state.archivedChats].find((item) => item.id === chatId)
  if (first.messages.length === 0 && !emptyPageIsHistory(first, chat)) throw new ColdCacheError()

  let messages = first.messages
  let hasMore = first.hasMore
  let hasNewer = false
  /** The around request itself failed (not "the row is gone"). */
  let aroundFailed = false
  const oldest = messages[0]
  if (target !== null && oldest !== undefined && oldest.id > target.messageId) {
    onRestoring()
    let around: { messages: Message[]; hasMore: boolean; hasNewer: boolean } | null = null
    try {
      around = await invoke('messages:around', {
        chatId,
        messageId: target.messageId,
        limit: AROUND_CONTEXT,
      })
    } catch (error) {
      // A failed window fetch must not blank the transcript: the newest page is
      // still a usable answer and the query keeps its retry for a cold fetch.
      if (signal.aborted) throw error
      around = null
      aroundFailed = true
    }
    signal.throwIfAborted()
    if (around !== null) {
      messages = around.messages
      hasMore = around.hasMore
      hasNewer = around.hasNewer
    }
  }

  // A located row outranks the saved position and the unread divider: the reader
  // asked for that message from the viewer, and that is where the chat opens.
  let landing = locateLanding(messages, locating) ?? resolveLanding(messages, marker, anchor)
  if (locating === null && target !== null && landing === null) {
    // The row we paged for is gone (deleted, or the window came back without it).
    // The newest page is the only honest fallback; opening on an arbitrary row
    // would be worse than opening at the bottom.
    messages = first.messages
    hasMore = first.hasMore
    hasNewer = false
    landing = resolveLanding(messages, marker, anchor)
  }
  signal.throwIfAborted()

  // Past this line the fetch is committed: an aborted query must not leave a page
  // in the store that nobody asked for any more.
  useAppStore.getState().setHistory(chatId, messages, hasMore, hasNewer)
  /**
   * A saved position we actually paged for and still could not reach (deleted):
   * drop it, so the next open stays instant instead of paging back again for
   * nothing. An anchor that lost to the unread divider is *not* dropped — it was
   * never the target, and it is still a valid place to return to once the chat has
   * no unread messages.
   */
  const anchorFound = anchor ? messages.some((message) => message.id === anchor.messageId) : false
  // A failed around request proves nothing about the row: keep the anchor so the
  // next open can try again. Only a window that came back without it (deleted)
  // justifies dropping the saved position.
  if (target?.kind === 'anchor' && !anchorFound && !aroundFailed) {
    void invoke('ui:saveAnchor', { chatId, messageId: null, offset: 0 }).catch(() => undefined)
  }

  return { chatId, messages, hasMore, hasNewer, landing }
}
