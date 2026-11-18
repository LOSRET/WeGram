import type { SliceCreator, UiActions } from '../types'

export const createUiSlice: SliceCreator<UiActions> = (set) => ({
  setTyping: (chatId, active) =>
    set((state) => ({ typingByChat: { ...state.typingByChat, [chatId]: active } })),

  setToast: (toast) => set({ toast }),
  setError: (error) => set({ error }),

  noteStickerSetsChanged: () =>
    set((state) => ({ stickerSetsVersion: state.stickerSetsVersion + 1 })),
})
