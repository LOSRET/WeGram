import { mergeChatList, routeChatOps, sortChats } from '../reducers'
import type { ChatActions, SliceCreator } from '../types'

/**
 * The conversation list and the archive.
 *
 * A `remove` op is 删除聊天 and must take the transcript with it: leaving
 * `messagesByChat[chatId]` behind would make the next TDLib id collision draw an
 * old row, and an open pane would keep rendering a chat that no longer exists.
 * The same op arrives for 退出群聊, so the cleanup is not optional.
 *
 * 归档 is the other direction: the adapter answers with a summary whose
 * `archived` flag moved, and `routeChatOps` puts the row in the other list. No
 * `remove` op is sent for it, which is exactly why the transcript stays loaded.
 */
export const createChatsSlice: SliceCreator<ChatActions> = (set, get) => ({
  setChats: (chats) => set({ chats: sortChats(chats) }),

  setArchivedChats: (chats) => set({ archivedChats: sortChats(chats) }),

  /** 分页 and the resync repair add to a list; see `mergeChatList`. */
  mergeChats: (list, page) =>
    set((state) =>
      list === 'main'
        ? { chats: mergeChatList(state.chats, page) }
        : { archivedChats: mergeChatList(state.archivedChats, page) },
    ),

  /** Live chat updates: upsert by id (moving between Main and Archive), delete on a delete op. */
  applyChatOps: (ops) => {
    const state = get()
    const routed = routeChatOps(
      { chats: state.chats, archivedChats: state.archivedChats },
      ops,
    )
    if (routed.removed.length === 0) {
      set({ chats: routed.chats, archivedChats: routed.archivedChats })
      return
    }

    const messagesByChat = { ...state.messagesByChat }
    const pendingOps = { ...state.pendingOps }
    const hasMoreByChat = { ...state.hasMoreByChat }
    const hasNewerByChat = { ...state.hasNewerByChat }
    const olderPagesByChat = { ...state.olderPagesByChat }
    const unreadMarkers = { ...state.unreadMarkers }
    for (const chatId of routed.removed) {
      delete messagesByChat[chatId]
      delete pendingOps[chatId]
      delete hasMoreByChat[chatId]
      delete hasNewerByChat[chatId]
      delete olderPagesByChat[chatId]
      delete unreadMarkers[chatId]
    }
    const activeChatId =
      state.activeChatId !== null && routed.removed.includes(state.activeChatId)
        ? null
        : state.activeChatId
    set({
      chats: routed.chats,
      archivedChats: routed.archivedChats,
      messagesByChat,
      pendingOps,
      hasMoreByChat,
      hasNewerByChat,
      olderPagesByChat,
      unreadMarkers,
      activeChatId,
    })
  },

  /**
   * A chat switch also leaves any topic behind: a forum opens on its topic list
   * (design doc §9.12), never on the last topic of another chat.
   */
  setActiveChat: (activeChatId) => set({ activeChatId, activeTopicId: null }),
})
