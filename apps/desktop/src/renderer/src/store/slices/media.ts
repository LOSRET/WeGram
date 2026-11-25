import type { MediaActions, SliceCreator } from '../types'

export const createMediaSlice: SliceCreator<MediaActions> = (set) => ({
  // A download completes once but `evt:file` keeps arriving for the same file;
  // returning the unchanged state keeps every subscriber from re-rendering.
  setMediaUrl: (fileId, url) =>
    set((state) =>
      state.mediaUrls[fileId] === url
        ? state
        : { mediaUrls: { ...state.mediaUrls, [fileId]: url } },
    ),

  setMediaProgress: (fileId, progress, url) =>
    set((state) => ({
      mediaProgress: { ...state.mediaProgress, [fileId]: progress },
      ...(url ? { mediaUrls: { ...state.mediaUrls, [fileId]: url } } : {}),
    })),

  // Returning the unchanged state keeps every subscriber from re-rendering when
  // there was nothing cached to drop.
  clearMediaUrls: () =>
    set((state) => (Object.keys(state.mediaUrls).length === 0 ? state : { mediaUrls: {} })),
})
