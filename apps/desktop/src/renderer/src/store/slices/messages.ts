import { EMPTY_MESSAGES, PENDING_OPS_LIMIT, hasReplayableOps, reduceOps } from '../reducers'
import type { MessageActions, SliceCreator } from '../types'

/**
 * Transcript state. The rule that matters lives here and is easy to undo by
 * accident, so it is stated twice: in the code and in the test.
 *
 * `messagesByChat[chatId]` is created **only** by `setHistory`/`prependHistory`.
 * `ChatPane` reads "an entry exists" as "the first page is cached" and skips the
 * fetch; a read marker fires for every chat, so letting an event create the entry
 * makes every conversation open empty and never page back.
 */
export const createMessagesSlice: SliceCreator<MessageActions> = (set) => ({
  setHistory: (chatId, messages, hasMore) =>
    set((state) => {
      // The page snapshot was fetched before the queued events arrived: replay
      // them onto it (upsertMessage dedupes by id) and drop the queue. Without
      // this, anything that arrived while the first page was in flight was
      // lost for good — the pane looked loaded but was missing messages.
      const pending = state.pendingOps[chatId]
      const pendingOps = { ...state.pendingOps }
      if (pending !== undefined) delete pendingOps[chatId]
      const page = pending ? reduceOps(messages, pending).list : messages
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: page },
        hasMoreByChat: { ...state.hasMoreByChat, [chatId]: hasMore },
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

  setLoadingOlder: (chatId, loading) =>
    set((state) => ({ loadingOlderByChat: { ...state.loadingOlderByChat, [chatId]: loading } })),

  setLoadingHistory: (chatId, loading) =>
    set((state) => ({
      loadingHistoryByChat: { ...state.loadingHistoryByChat, [chatId]: loading },
    })),

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

      const { list, deleted } = reduceOps(existing, ops)

      // A deleted message must not stay referenced by the edit banner or the
      // reply target, or the next send quotes a message that no longer exists.
      let editing = state.editing
      if (editing && editing.chatId === chatId && deleted.has(editing.messageId)) editing = null

      let replyToByChat = state.replyToByChat
      const replyingTo = replyToByChat[chatId]
      if (replyingTo != null && deleted.has(replyingTo)) {
        replyToByChat = { ...replyToByChat, [chatId]: null }
      }

      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: list },
        editing,
        replyToByChat,
      }
    }),

  setReplyTo: (chatId, messageId) =>
    set((state) => ({ replyToByChat: { ...state.replyToByChat, [chatId]: messageId } })),

  setEditing: (editing) => set({ editing }),

  setUnreadMarker: (chatId, marker) =>
    set((state) => ({
      unreadMarkers: { ...state.unreadMarkers, [chatId]: marker },
    })),
})
