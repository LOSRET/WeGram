import type { MessageOp } from '@wegram/protocol'

import {
  EMPTY_MESSAGES,
  PENDING_OPS_LIMIT,
  appendNewerMessages,
  hasReplayableOps,
  reduceOps,
  splitOpsForWindow,
} from '../reducers'
import type { MessageActions, OlderPage, SliceCreator } from '../types'

/**
 * A prefetched page may only be inserted while it is still contiguous with the
 * transcript, and only while its rows are still what the server sent.
 *
 *  - A `delete`/`edit`/`replace` for a buffered id makes the snapshot wrong (a
 *    deleted row would come back when the page is prepended).
 *  - Anything else (a live arrival, a read marker) leaves it usable.
 */
function bufferStillUsable(page: OlderPage, ops: MessageOp[]): boolean {
  const ids = new Set(page.messages.map((message) => message.id))
  return !ops.some((op) => {
    if (op.op === 'delete') return op.messageIds.some((id) => ids.has(id))
    if (op.op === 'edit') return ids.has(op.messageId)
    if (op.op === 'replace') return ids.has(op.message.id)
    return false
  })
}

/**
 * Transcript state. The rule that matters lives here and is easy to undo by
 * accident, so it is stated twice: in the code and in the test.
 *
 * `messagesByChat[chatId]` is created **only** by `setHistory`/`prependHistory`.
 * `ChatPane` reads "an entry exists" as "the first page is cached" and skips the
 * fetch; a read marker fires for every chat, so letting an event create the entry
 * makes every conversation open empty and never page back.
 *
 * A window may also be *anchored*: `hasNewerByChat[chatId]` says the loaded rows
 * do not reach the newest message (the reader landed on a deep saved position or
 * a deep unread boundary). Live arrivals are then queued instead of appended —
 * splicing them on would draw them under the window's last row and leave the
 * skipped months invisible — until `appendNewer` walks the window down to the
 * latest message.
 */
export const createMessagesSlice: SliceCreator<MessageActions> = (set) => ({
  setHistory: (chatId, messages, hasMore, hasNewer = false) =>
    set((state) => {
      // The page snapshot was fetched before the queued events arrived: replay
      // them onto it (upsertMessage dedupes by id) and drop the queue. Without
      // this, anything that arrived while the first page was in flight was
      // lost for good — the pane looked loaded but was missing messages.
      const pending = state.pendingOps[chatId]
      const pendingOps = { ...state.pendingOps }
      let page = messages
      if (pending !== undefined) {
        delete pendingOps[chatId]
        if (hasNewer) {
          // The page stops short of the newest message: only the ops inside the
          // window may be replayed, the rest wait for `appendNewer`.
          const { applicable, deferred } = splitOpsForWindow(messages, pending)
          if (applicable.length > 0) page = reduceOps(messages, applicable).list
          if (deferred.length > 0) pendingOps[chatId] = deferred
        } else {
          page = reduceOps(messages, pending).list
        }
      }
      // A replaced window makes any page fetched below the old one meaningless:
      // `afterId` would still match a row of the new window by accident.
      const olderPagesByChat = { ...state.olderPagesByChat }
      delete olderPagesByChat[chatId]
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: page },
        hasMoreByChat: { ...state.hasMoreByChat, [chatId]: hasMore },
        olderPagesByChat,
        hasNewerByChat: { ...state.hasNewerByChat, [chatId]: hasNewer },
        pendingOps,
      }
    }),

  prependHistory: (chatId, messages, hasMore) =>
    set((state) => {
      const existing = state.messagesByChat[chatId] ?? EMPTY_MESSAGES
      const seen = new Set(existing.map((message) => message.id))
      const older = messages.filter((message) => !seen.has(message.id))
      // The buffered page has just been inserted (or bypassed): the oldest row
      // moved, so whatever was waiting below it is stale by definition.
      const olderPagesByChat = { ...state.olderPagesByChat }
      delete olderPagesByChat[chatId]
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: [...older, ...existing] },
        hasMoreByChat: { ...state.hasMoreByChat, [chatId]: hasMore },
        olderPagesByChat,
      }
    }),

  bufferOlderPage: (chatId, afterId, messages, hasMore) =>
    set((state) => {
      const existing = state.messagesByChat[chatId] ?? EMPTY_MESSAGES
      // An empty answer means "not there yet" (a cold TDLib cache answers `[]`):
      // buffering it would insert nothing and report the wrong `hasMore`.
      if (messages.length === 0 || existing[0]?.id !== afterId) return {}
      return {
        olderPagesByChat: {
          ...state.olderPagesByChat,
          [chatId]: { afterId, messages, hasMore },
        },
      }
    }),

  appendNewer: (chatId, messages, hasNewer) =>
    set((state) => {
      const existing = state.messagesByChat[chatId] ?? EMPTY_MESSAGES
      let list = appendNewerMessages(existing, messages)
      const pending = state.pendingOps[chatId]
      const pendingOps = { ...state.pendingOps }
      if (pending !== undefined && pending.length > 0) {
        delete pendingOps[chatId]
        if (hasNewer) {
          // Still short of the newest message: only ops inside the window apply.
          const { applicable, deferred } = splitOpsForWindow(list, pending)
          if (applicable.length > 0) list = reduceOps(list, applicable).list
          if (deferred.length > 0) pendingOps[chatId] = deferred
        } else {
          // The window now reaches the newest message; the queued ops are the
          // contiguous tail (a live arrival that raced this page), not a gap.
          list = reduceOps(list, pending).list
        }
      }
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: list },
        hasNewerByChat: { ...state.hasNewerByChat, [chatId]: hasNewer },
        pendingOps,
      }
    }),

  applyMessageOps: (chatId, ops) =>
    set((state) => {
      // Only a chat whose first page is already in memory may be patched here.
      // See the note above: creating an entry for a chat we never opened is what
      // made groups open empty and never page back.
      const existing = state.messagesByChat[chatId]
      if (existing === undefined) {
        // First page still in flight: queue the ops so `setHistory` replays them
        // onto the page. Dropping them silently lost whatever arrived during the
        // fetch, and a cold chat can take seconds to answer.
        if (!hasReplayableOps(ops)) return {}
        const queued = state.pendingOps[chatId] ?? []
        return {
          pendingOps: {
            ...state.pendingOps,
            [chatId]: [...queued, ...ops].slice(-PENDING_OPS_LIMIT),
          },
        }
      }

      // An anchored window cannot take a row that belongs beyond its newest row:
      // that would hide the gap between the two. Hold it until the window reaches
      // that id (appendNewer) or is replaced by the newest page.
      const anchored = state.hasNewerByChat[chatId] === true
      const split = anchored ? splitOpsForWindow(existing, ops) : null
      const { list, deleted } = reduceOps(existing, split?.applicable ?? ops)

      // A deleted message must not stay referenced by the edit banner or the
      // reply target, or the next send quotes a message that no longer exists.
      let editing = state.editing
      if (editing && editing.chatId === chatId && deleted.has(editing.messageId)) editing = null

      let replyToByChat = state.replyToByChat
      const replyingTo = replyToByChat[chatId]
      if (replyingTo != null && deleted.has(replyingTo)) {
        replyToByChat = { ...replyToByChat, [chatId]: null }
      }

      let pendingOps = state.pendingOps
      const deferred: MessageOp[] = split?.deferred ?? []
      if (deferred.length > 0) {
        const queued = pendingOps[chatId] ?? []
        pendingOps = {
          ...pendingOps,
          [chatId]: [...queued, ...deferred].slice(-PENDING_OPS_LIMIT),
        }
      }

      /**
       * A prefetched page is a snapshot: it is only worth keeping while it is
       * still contiguous with the transcript (`afterId`) and none of its rows
       * changed. Prepending a stale one would bring a deleted message back or
       * draw an old caption. Dropping it costs one history request later; the
       * orphan row would be a correctness bug.
       */
      const buffered = state.olderPagesByChat[chatId]
      const stale =
        buffered !== undefined &&
        (list[0]?.id !== buffered.afterId ||
          !bufferStillUsable(buffered, split?.applicable ?? ops))
      let olderPagesByChat = state.olderPagesByChat
      if (stale) {
        olderPagesByChat = { ...state.olderPagesByChat }
        delete olderPagesByChat[chatId]
      }

      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: list },
        editing,
        replyToByChat,
        pendingOps,
        olderPagesByChat,
      }
    }),

  requestJumpToLatest: (chatId) =>
    set((state) => ({
      jumpToLatest: { chatId, tick: (state.jumpToLatest?.tick ?? 0) + 1 },
    })),

  requestLocate: (chatId, messageId) =>
    set((state) => ({
      locate: { chatId, messageId, tick: (state.locate?.tick ?? 0) + 1 },
    })),

  clearLocate: () => set({ locate: null }),

  setReplyTo: (chatId, messageId) =>
    set((state) => ({ replyToByChat: { ...state.replyToByChat, [chatId]: messageId } })),

  setEditing: (editing) => set({ editing }),

  setUnreadMarker: (chatId, marker) =>
    set((state) => ({
      unreadMarkers: { ...state.unreadMarkers, [chatId]: marker },
    })),
})
