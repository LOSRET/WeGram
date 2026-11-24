import type { SliceCreator, UiActions } from '../types'

export const createUiSlice: SliceCreator<UiActions> = (set) => ({
  setTyping: (chatId, active) =>
    set((state) => ({ typingByChat: { ...state.typingByChat, [chatId]: active } })),

  setPeerStatus: (userId, status) =>
    set((state) => ({ peerStatusByUser: { ...state.peerStatusByUser, [userId]: status } })),

  setToast: (toast) => set({ toast }),
  setAlert: (alert) => set({ alert }),
  setError: (error) => set({ error }),

  noteStickerSetsChanged: () =>
    set((state) => ({ stickerSetsVersion: state.stickerSetsVersion + 1 })),
})
