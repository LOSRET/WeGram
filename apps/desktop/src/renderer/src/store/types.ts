import type {
  ChatOp,
  ChatSummary,
  ChatTopic,
  AppInfo,
  AuthState,
  ConnectionState,
  Message,
  MessageOp,
  MessageTextSize,
  PeerStatus,
  SendKey,
  UserAvatar,
} from '@wegram/protocol'
import type { StateCreator } from 'zustand'

import type { ChatListName } from './reducers'
import type { UnreadBoundary } from '../lib/unreadBoundary'

export interface EditingState {
  chatId: number
  messageId: number
  text: string
  /**
   * A media row's 说明 rather than a text message: the composer saves it through
   * `messages:editCaption`, and an empty box removes the caption. See
   * `lib/editTarget.ts` for which rows can take either path.
   */
  caption?: boolean
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
 * paint. Same shape as the list's landing boundary (see lib/unreadBoundary.ts).
 */
export type UnreadMarker = UnreadBoundary

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
  /** 发送消息's rule; the composer reads it when an Enter lands (evt:settings). */
  sendKey: SendKey
  /**
   * 消息字号; the shell writes it to `data-msg-size` on <html>, which is the one
   * place the transcript's scale comes from (evt:settings, design doc §9.11.3).
   */
  messageTextSize: MessageTextSize
  chats: ChatSummary[]
  /**
   * 已归档会话, TDLib's second chat list. It is a list of its own rather than a
   * filter over `chats`: an archived chat is not in the main list at all, and the
   * entry row that leads the conversation list reads its unread total from here.
   */
  archivedChats: ChatSummary[]
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
  /**
   * One-shot `/start` payload captured from a bot deep link. It survives chat
   * switches until a message is sent, then is cleared; it is never persisted.
   */
  botStartParametersByChat: Record<number, string>
  typingByChat: Record<number, boolean>
  /**
   * userId → online / last seen. Kept apart from the chat rows because presence
   * changes on its own schedule (`evt:status`) and the same person can be the peer
   * of one chat and a member of another.
   */
  peerStatusByUser: Record<number, PeerStatus>
  editing: EditingState | null
  toast: string | null
  /**
   * A bot's alert answer (`callbackQueryAnswer.show_alert`): a message the bot
   * wants shown as a dialog rather than a toast, because a toast is easy to miss.
   */
  alert: string | null
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
  /**
   * 话题 (design doc §9.12): a forum chat's topic list, as last read. Kept beside
   * the chat rather than on it because it is paged and refreshed on its own.
   */
  topicsByChat: Record<number, ChatTopic[]>
  /**
   * The topic the reader is inside, for the active chat; `null` means the topic
   * list is what the pane shows (a forum) or the chat has no topics at all.
   */
  activeTopicId: number | null
  /**
   * Which topic `messagesByChat[chatId]` belongs to — `null` for a flat transcript.
   * A cached page may only be reused for the topic it was fetched for; reusing it
   * for another would show one topic's rows under another's name (the same trap
   * as the "empty group" bug, one level down).
   */
  historyTopicByChat: Record<number, number | null>
  /** Bumped by `evt:topics`; the topic list refetches when it moves. */
  topicsVersion: number
  /**
   * 论坛展示方式 per forum (design doc §9.12): `tabs` puts the topic strip above the
   * messages, `sidebar` is this client's column. Unknown until the chat opened.
   */
  forumLayoutByChat: Record<number, 'tabs' | 'sidebar'>
}

export interface AuthActions {
  setAuth: (state: AuthState) => void
  setConnection: (state: ConnectionState) => void
  setInfo: (info: AppInfo) => void
  setTheme: (theme: 'light' | 'dark') => void
  setSendKey: (sendKey: SendKey) => void
  setMessageTextSize: (size: MessageTextSize) => void
  /** Clears every chat/message/media field, used on logout. */
  reset: () => void
}

export interface TopicActions {
  /** The list a page (or a refresh) produced; replaces the chat's cached topics. */
  setTopics: (chatId: number, topics: ChatTopic[]) => void
  /** Append one page (the list's cursor paging). */
  mergeTopics: (chatId: number, topics: ChatTopic[]) => void
  /**
   * `evt:topics` said this forum changed. The hook bumps a version instead of
   * patching rows: TDLib's update carries only part of a topic's state.
   */
  noteTopicsChanged: () => void
  /** Enter a topic, or (`null`) go back to the topic list. */
  setActiveTopic: (topicId: number | null) => void
  /** 论坛展示方式, learned when the chat opens. */
  setForumLayout: (chatId: number, layout: 'tabs' | 'sidebar') => void
}

export interface ChatActions {
  setChats: (chats: ChatSummary[]) => void
  setArchivedChats: (chats: ChatSummary[]) => void
  /**
   * Append a page of chats (分页 as the reader reaches the end) or repair the
   * loaded rows after an event gap. The page wins on conflict; rows it does not
   * mention stay, so a loaded page is never dropped by a 100-row refetch.
   */
  mergeChats: (list: ChatListName, page: ChatSummary[]) => void
  applyChatOps: (ops: ChatOp[]) => void
  setActiveChat: (chatId: number | null) => void
  /** Remembers the validated payload of a `t.me/bot?start=...` link. */
  setBotStartParameter: (chatId: number, parameter: string) => void
  /** Consumes or discards a bot link's one-shot payload. */
  clearBotStartParameter: (chatId: number) => void
}

export interface MessageActions {
  setHistory: (
    chatId: number,
    messages: Message[],
    hasMore: boolean,
    hasNewer?: boolean,
    /** 话题 the page belongs to; `null`/absent is a flat transcript. */
    topicId?: number | null,
  ) => void
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
  setPeerStatus: (userId: number, status: PeerStatus) => void
  setToast: (message: string | null) => void
  /** A bot's alert answer; drawn as a one-button dialog, dismissed by 确定. */
  setAlert: (message: string | null) => void
  setError: (message: string | null) => void
  noteStickerSetsChanged: () => void
}

export interface AppState
  extends
    AppData,
    AuthActions,
    ChatActions,
    TopicActions,
    MessageActions,
    AvatarActions,
    MediaActions,
    UiActions {}

/**
 * A zustand slice: it may only return actions, never data. Data is seeded by
 * `useAppStore` from `DATA_DEFAULTS` so `reset()` stays exhaustive.
 */
export type SliceCreator<TActions> = StateCreator<AppState, [], [], TActions>
