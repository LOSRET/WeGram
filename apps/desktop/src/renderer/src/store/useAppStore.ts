import { create } from 'zustand'

import { DATA_DEFAULTS } from './initialState'
import { createAuthSlice } from './slices/auth'
import { createAvatarsSlice } from './slices/avatars'
import { createChatsSlice } from './slices/chats'
import { createMediaSlice } from './slices/media'
import { createMessagesSlice } from './slices/messages'
import { createTopicsSlice } from './slices/topics'
import { createUiSlice } from './slices/ui'
import type { AppState } from './types'

/**
 * The renderer's single zustand store, assembled from slices.
 *
 * Layout: `initialState.ts` owns the data defaults, `slices/*` own the actions,
 * `reducers.ts` owns the pure transitions. Callers keep importing
 * `useAppStore` (and the types they need) from here, so the split is invisible to
 * components.
 *
 * Protocol-independent UI state (drafts, theme, scroll anchor) is NOT here — it
 * lives in `ui.db` via main; this store only mirrors what the current session sees.
 */
export const useAppStore = create<AppState>()((set, get, api) => ({
  ...DATA_DEFAULTS,

  ...createAuthSlice(set, get, api),
  ...createChatsSlice(set, get, api),
  ...createTopicsSlice(set, get, api),
  ...createMessagesSlice(set, get, api),
  ...createAvatarsSlice(set, get, api),
  ...createMediaSlice(set, get, api),
  ...createUiSlice(set, get, api),
}))

export type { AppState, EditingState, FileProgress, UnreadMarker } from './types'
