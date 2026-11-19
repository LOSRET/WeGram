import type { Message } from '@wegram/protocol'

import type { LandingPosition } from '../../message-list/unread'

/** Messages kept on each side of a message when a window is loaded around it. */
export const AROUND_CONTEXT = 25

export interface PendingLanding {
  chatId: number
  position: LandingPosition
}

export interface ChatHistoryState {
  /** Where this chat opens: saved row, unread divider, or null → newest message. */
  pendingLanding: PendingLanding | null
  /**
   * The anchor has been resolved for the active chat. The list must not mount
   * before that: it captures its reading position once on the first paint, and a
   * cached chat would otherwise land at the bottom and miss the restore.
   */
  anchorKnown: boolean
  /** Paging back towards a saved anchor (can take a moment on the real account). */
  restoring: boolean
  /** The first page is still in flight; the pane shows its loading state while empty. */
  loadingHistory: boolean
  /**
   * The row 定位到聊天位置 asked for, once it is in the loaded window. The list
   * scrolls to it and flashes it; it clears itself after `LOCATED_CLEAR_MS`.
   */
  located: { chatId: number; messageId: number } | null
  loadingOlder: boolean
  /**
   * Keep one page of older history in hand (`olderPagesByChat`) so the reader's
   * next scroll towards the top does not have to wait for TDLib. Idempotent and
   * fire-and-forget: it refuses to start twice, and a stale answer is dropped by
   * the store.
   */
  prefetchOlder: () => void
  /** The loaded window stops short of the newest message (anchored by a deep row). */
  hasNewer: boolean
  /** Empty-state "reload" button: re-runs the first-page fetch. */
  reload: () => void
  loadOlder: () => Promise<void>
  /** Extends an anchored window down; call it when the reader nears its end. */
  loadNewer: () => Promise<void>
}

/** What one first-page fetch produced, cached by react-query per chat. */
export interface FirstPage {
  chatId: number
  messages: Message[]
  hasMore: boolean
  hasNewer: boolean
  landing: LandingPosition | null
}

/**
 * The page came back empty although the chat list says the conversation has
 * messages. TDLib answers like that right after a start, while its local database
 * is still syncing, and caching it is the "blank transcript for the rest of the
 * session" bug. It is thrown, not returned, so that the query's `retry` owns the
 * decision to ask again and the cache holds an **error instead of an empty page** —
 * the next open, or 重新加载, therefore asks again by construction.
 */
export class ColdCacheError extends Error {
  constructor() {
    super('messages:history returned an empty page the chat list contradicts')
    this.name = 'ColdCacheError'
  }
}
