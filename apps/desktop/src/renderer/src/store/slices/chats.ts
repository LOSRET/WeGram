import { sortChats } from '../reducers'
import type { ChatActions, SliceCreator } from '../types'

export const createChatsSlice: SliceCreator<ChatActions> = (set, get) => ({
  setChats: (chats) => set({ chats: sortChats(chats) }),

  /** Live chat updates: upsert by id, delete on a delete op, keep the order. */
  applyChatOps: (ops) => {
    const byId = new Map(get().chats.map((chat) => [chat.id, chat]))
    for (const op of ops) {
      if (op.op === 'upsert') byId.set(op.chat.id, op.chat)
      else byId.delete(op.chatId)
    }
    set({ chats: sortChats([...byId.values()]) })
  },

  setActiveChat: (activeChatId) => set({ activeChatId }),
})
