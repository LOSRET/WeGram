import type { AvatarActions, SliceCreator } from '../types'

/**
 * Late profile photos, keyed by user id.
 *
 * Kept out of the message list on purpose: the same sender appears in many
 * chats, and a batch may carry photos for senders whose rows are not on screen.
 * An unchanged entry keeps the previous state object so subscribers (the
 * transcript) do not re-render for a photo they already draw.
 */
export const createAvatarsSlice: SliceCreator<AvatarActions> = (set) => ({
  setUserAvatars: (avatars) =>
    set((state) => {
      let next = state.userAvatars
      for (const avatar of avatars) {
        if (next[avatar.userId] === avatar.url) continue
        if (next === state.userAvatars) next = { ...state.userAvatars }
        next[avatar.userId] = avatar.url
      }
      // Returning the state itself keeps zustand from notifying subscribers for a
      // batch that carried nothing new.
      return next === state.userAvatars ? state : { userAvatars: next }
    }),
})
