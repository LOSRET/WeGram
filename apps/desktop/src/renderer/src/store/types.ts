import type {
  ChatOp,
  ChatSummary,
  AppInfo,
  AuthState,
  ConnectionState,
  Message,
  MessageOp,
} from '@wechatgram/protocol'
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
 * Snapshot of what was unread when the chat was opened, captured *before*
 * `chats:open` marks it read — otherwise the unread divider would vanish on the
 * first paint.
 */
export interface UnreadMarker {
  lastReadInboxMessageId: number | null
  unread: number
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
  loadingOlderByChat: Record<number, boolean>
  loadingHistoryByChat: Record<number, boolean>
  replyToByChat: Record<number, number | null>
  typingByChat: Record<number, boolean>
  editing: EditingState | null
  toast: string | null
  error: string | null
  /** fileId → wx-media:// URL, filled by downloads and by `evt:file`. */
  mediaUrls: Record<number, string>
  mediaProgress: Record<number, FileProgress>
  unreadMarkers: Record<number, UnreadMarker | null>
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
  setHistory: (chatId: number, messages: Message[], hasMore: boolean) => void
  prependHistory: (chatId: number, messages: Message[], hasMore: boolean) => void
  setLoadingOlder: (chatId: number, loading: boolean) => void
  setLoadingHistory: (chatId: number, loading: boolean) => void
  applyMessageOps: (chatId: number, ops: MessageOp[]) => void
  setReplyTo: (chatId: number, messageId: number | null) => void
  setEditing: (editing: EditingState | null) => void
  setUnreadMarker: (chatId: number, marker: UnreadMarker | null) => void
}

export interface MediaActions {
  setMediaUrl: (fileId: number, url: string) => void
  setMediaProgress: (fileId: number, progress: FileProgress, url?: string) => void
}

export interface UiActions {
  setTyping: (chatId: number, active: boolean) => void
  setToast: (message: string | null) => void
  setError: (message: string | null) => void
}

export interface AppState extends AppData, AuthActions, ChatActions, MessageActions, MediaActions, UiActions {}

/**
 * A zustand slice: it may only return actions, never data. Data is seeded by
 * `useAppStore` from `DATA_DEFAULTS` so `reset()` stays exhaustive.
 */
export type SliceCreator<TActions> = StateCreator<AppState, [], [], TActions>
