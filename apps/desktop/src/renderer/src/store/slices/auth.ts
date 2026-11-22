import { DATA_DEFAULTS } from '../initialState'
import type { AuthActions, SliceCreator } from '../types'

export const createAuthSlice: SliceCreator<AuthActions> = (set) => ({
  setAuth: (auth) => set({ auth }),
  setConnection: (connection) => set({ connection }),
  setInfo: (info) => set({ info }),
  setTheme: (theme) => set({ theme }),
  setSendKey: (sendKey) => set({ sendKey }),

  /**
   * Logout: clear every chat/message/media field but keep the shell usable.
   * `DATA_DEFAULTS` is the single source of truth for what "cleared" means, so a
   * field added later is reset without touching this function.
   */
  reset: () => set({ ...DATA_DEFAULTS }),
})
