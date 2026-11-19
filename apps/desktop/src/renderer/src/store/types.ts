import type {
  ChatOp,
  ChatSummary,
  AppInfo,
  AuthState,
  ConnectionState,
  Message,
  MessageOp,
  UserAvatar,
} from '@wegram/protocol'
import type { StateCreator } from 'zustand'

export interface EditingState {
  chatId: number
  messageId: number
  text: string
}

/** Progress of one file: own uploads and incoming downloads share the shape. */
export interface FileProgress {
  downloaded: number
  total: number
  completed: boolean
  uploading: boolean
}

/**
 * Snapshot of what was unread when the chat was opened, captured *before* the
 * read marker can move — otherwise the unread divider would vanish on the first
 * paint.
 */
export interface UnreadMarker {
  lastReadInboxMessageId: number | null
  unread: number
}

/**
 * A page of older messages fetched ahead of the reader but not yet in the
 * transcript (see `useChatHistory.prefetchOlder`).
 *
 * TDLib answers an older page from its local cache or from the server, and the
 * first server answer was measured at ~3.4 s — no wheel gesture survives that.
 * Keeping one page in hand turns "scroll up and wait" into "scroll up and it is
 * already there". `afterId` is the oldest loaded id the page was fetched below:
 * the page is only usable while that is *still* the oldest loaded row.
 */
export interface OlderPage {
  afterId: number
  messages: Message[]
  hasMore: boolean
}

/**
 * Every piece of state the UI reads. Actions live in the slice interfaces below;
 * the data itself is seeded once from `DATA_DEFAULTS` (`initialState.ts`), so a
 * field can never be forgotten by `reset()`.
 */
export interface AppData {
  auth: AuthState
  connection: ConnectionState
  info: AppInfo | null
  theme: 'light' | 'dark'
  chats: ChatSummary[]
  activeChatId: number | null
  messagesByChat: Record<number, Message[]>
  /** Ops that arrived before a chat's first page did; replayed by setHistory. */
  pendingOps: Record<number, MessageOp[]>
  /** true when older messages may still exist on the server */
  hasMoreByChat: Record<number, boolean>
  /**
   * chatId → one page fetched below the oldest loaded row, not yet inserted.
   * It lives in the store rather than in the fetching hook because a deletion
   * or an edit of a buffered message must be able to invalidate it.
   */
  olderPagesByChat: Record<number, OlderPage>
  /**
   * true when the loaded window does not reach the newest message. The reader
   * landed on an old row (saved position or deep unread) and the window was
   * loaded around it; new arrivals are queued instead of being spliced into the
   * gap, and the list appends pages forward as the reader scrolls down.
   */
  hasNewerByChat: Record<number, boolean>
  /** Per-chat request to scroll to the newest message after a window reload. */
  jumpToLatest: { chatId: number; tick: number } | null
  /**
   * 定位到聊天位置: the row the viewer asked the shell to show. `tick` makes a
   * repeated locate of the same row a new request; the landing path reads it once
   * and the list clears it after it has scrolled (see `clearLocate`).
   */
  locate: { chatId: number; messageId: number; tick: number } | null
  replyToByChat: Record<number, number | null>
  typingByChat: Record<number, boolean>
  editing: EditingState | null
  toast: string | null
  error: string | null
  /** fileId → wx-media:// URL, filled by downloads and by `evt:file`. */
  mediaUrls: Record<number, string>
  mediaProgress: Record<number, FileProgress>
  /**
   * userId → wx-media:// URL for photos that finished downloading after their
   * rows were mapped (`evt:avatars`). The same person posts in several chats, so
   * the face lives here instead of on each message.
   */
  userAvatars: Record<number, string>
  unreadMarkers: Record<number, UnreadMarker | null>
  /**
   * Bumped when TDLib reloads the installed sticker sets; the picker refetches
   * on the change because the first answer can be the pre-sync local cache.
   */
  stickerSetsVersion: number
}

export interface AuthActions {
  setAuth: (state: AuthState) => void
  setConnection: (state: ConnectionState) => void
  setInfo: (info: AppInfo) => void
  setTheme: (theme: 'light' | 'dark') => void
  /** Clears every chat/message/media field, used on logout. */
  reset: () => void
}

export interface ChatActions {
  setChats: (chats: ChatSummary[]) => void
  applyChatOps: (ops: ChatOp[]) => void
  setActiveChat: (chatId: number | null) => void
}

export interface MessageActions {
  setHistory: (chatId: number, messages: Message[], hasMore: boolean, hasNewer?: boolean) => void
  prependHistory: (chatId: number, messages: Message[], hasMore: boolean) => void
  /** Extends an anchored window downward, keeping any ops that are still ahead. */
  appendNewer: (chatId: number, messages: Message[], hasNewer: boolean) => void
  /**
   * Keep a page fetched ahead of the reader. Ignored when `afterId` is no longer
   * the oldest loaded row, or when the page is empty (a cold TDLib cache answers
   * `[]`, and buffering that would stop paging for good).
   */
  bufferOlderPage: (chatId: number, afterId: number, messages: Message[], hasMore: boolean) => void
  applyMessageOps: (chatId: number, ops: MessageOp[]) => void
  /** Ask the list to scroll to the newest message (after a latest-window reload). */
  requestJumpToLatest: (chatId: number) => void
  /** Ask the shell to open a conversation on one message (定位到聊天位置). */
  requestLocate: (chatId: number, messageId: number) => void
  /** The locate was honoured (or its row is gone); it must not be replayed. */
  clearLocate: () => void
  setReplyTo: (chatId: number, messageId: number | null) => void
  setEditing: (editing: EditingState | null) => void
  setUnreadMarker: (chatId: number, marker: UnreadMarker | null) => void
}

export interface AvatarActions {
  setUserAvatars: (avatars: UserAvatar[]) => void
}

export interface MediaActions {
  setMediaUrl: (fileId: number, url: string) => void
  setMediaProgress: (fileId: number, progress: FileProgress, url?: string) => void
}

export interface UiActions {
  setTyping: (chatId: number, active: boolean) => void
  setToast: (message: string | null) => void
  setError: (message: string | null) => void
  noteStickerSetsChanged: () => void
}

export interface AppState
  extends
    AppData,
    AuthActions,
    ChatActions,
    MessageActions,
    AvatarActions,
    MediaActions,
    UiActions {}

/**
 * A zustand slice: it may only return actions, never data. Data is seeded by
 * `useAppStore` from `DATA_DEFAULTS` so `reset()` stays exhaustive.
 */
export type SliceCreator<TActions> = StateCreator<AppState, [], [], TActions>
