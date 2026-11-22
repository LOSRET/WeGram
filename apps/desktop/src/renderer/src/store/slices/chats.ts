import { sortChats } from '../reducers'
import type { ChatActions, SliceCreator } from '../types'

/**
 * The conversation list.
 *
 * A `remove` op is 删除聊天 and must take the transcript with it: leaving
 * `messagesByChat[chatId]` behind would make the next TDLib id collision draw an
 * old row, and an open pane would keep rendering a chat that no longer exists.
 * The same op arrives for 退出群聊, so the cleanup is not optional.
 */
export const createChatsSlice: SliceCreator<ChatActions> = (set, get) => ({
  setChats: (chats) => set({ chats: sortChats(chats) }),

  /** Live chat updates: upsert by id, delete on a delete op, keep the order. */
  applyChatOps: (ops) => {
    const state = get()
    const byId = new Map(state.chats.map((chat) => [chat.id, chat]))
    const removed: number[] = []
    for (const op of ops) {
      if (op.op === 'upsert') byId.set(op.chat.id, op.chat)
      else {
        byId.delete(op.chatId)
        removed.push(op.chatId)
      }
    }
    if (removed.length === 0) return set({ chats: sortChats([...byId.values()]) })

    const messagesByChat = { ...state.messagesByChat }
    const pendingOps = { ...state.pendingOps }
    const hasMoreByChat = { ...state.hasMoreByChat }
    const hasNewerByChat = { ...state.hasNewerByChat }
    const olderPagesByChat = { ...state.olderPagesByChat }
    const unreadMarkers = { ...state.unreadMarkers }
    for (const chatId of removed) {
      delete messagesByChat[chatId]
      delete pendingOps[chatId]
      delete hasMoreByChat[chatId]
      delete hasNewerByChat[chatId]
      delete olderPagesByChat[chatId]
      delete unreadMarkers[chatId]
    }
    const activeChatId =
      state.activeChatId !== null && removed.includes(state.activeChatId)
        ? null
        : state.activeChatId
    set({
      chats: sortChats([...byId.values()]),
      messagesByChat,
      pendingOps,
      hasMoreByChat,
      hasNewerByChat,
      olderPagesByChat,
      unreadMarkers,
      activeChatId,
    })
  },

  setActiveChat: (activeChatId) => set({ activeChatId }),
})
