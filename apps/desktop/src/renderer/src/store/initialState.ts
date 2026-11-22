import type { AppData } from './types'

/**
 * The one place the initial state is written down.
 *
 * `useAppStore` spreads this when the store is created, and `reset()` sets it
 * again on logout — so a newly added field cannot be forgotten by either path.
 * Keep it data-only; actions belong in `store/slices/*`.
 */
export const DATA_DEFAULTS: AppData = {
  auth: { kind: 'idle' },
  connection: 'offline',
  info: null,
  theme: 'light',
  sendKey: 'enter',
  chats: [],
  activeChatId: null,
  messagesByChat: {},
  pendingOps: {},
  hasMoreByChat: {},
  olderPagesByChat: {},
  hasNewerByChat: {},
  jumpToLatest: null,
  locate: null,
  replyToByChat: {},
  typingByChat: {},
  peerStatusByUser: {},
  editing: null,
  toast: null,
  error: null,
  mediaUrls: {},
  mediaProgress: {},
  userAvatars: {},
  unreadMarkers: {},
  stickerSetsVersion: 0,
}
