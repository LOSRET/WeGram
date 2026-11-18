import type { MessageOp } from '@wegram/protocol'

import {
  EMPTY_MESSAGES,
  PENDING_OPS_LIMIT,
  appendNewerMessages,
  hasReplayableOps,
  reduceOps,
  splitOpsForWindow,
} from '../reducers'
import type { MessageActions, SliceCreator } from '../types'

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
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: page },
        hasMoreByChat: { ...state.hasMoreByChat, [chatId]: hasMore },
        hasNewerByChat: { ...state.hasNewerByChat, [chatId]: hasNewer },
        pendingOps,
      }
    }),

  prependHistory: (chatId, messages, hasMore) =>
    set((state) => {
      const existing = state.messagesByChat[chatId] ?? EMPTY_MESSAGES
      const seen = new Set(existing.map((message) => message.id))
      const older = messages.filter((message) => !seen.has(message.id))
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: [...older, ...existing] },
        hasMoreByChat: { ...state.hasMoreByChat, [chatId]: hasMore },
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

      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: list },
        editing,
        replyToByChat,
        pendingOps,
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
