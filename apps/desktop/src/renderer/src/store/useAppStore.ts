import type {
  AppInfo,
  AuthState,
  ChatOp,
  ChatSummary,
  ConnectionState,
  Message,
  MessageOp,
} from '@wechatgram/protocol'
import { create } from 'zustand'

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

export interface AppState {
  auth: AuthState
  connection: ConnectionState
  info: AppInfo | null
  theme: 'light' | 'dark'
  chats: ChatSummary[]
  activeChatId: number | null
  messagesByChat: Record<number, Message[]>
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

  setAuth: (state: AuthState) => void
  setConnection: (state: ConnectionState) => void
  setInfo: (info: AppInfo) => void
  setTheme: (theme: 'light' | 'dark') => void
  setChats: (chats: ChatSummary[]) => void
  applyChatOps: (ops: ChatOp[]) => void
  setActiveChat: (chatId: number | null) => void
  setHistory: (chatId: number, messages: Message[], hasMore: boolean) => void
  prependHistory: (chatId: number, messages: Message[], hasMore: boolean) => void
  setLoadingOlder: (chatId: number, loading: boolean) => void
  setLoadingHistory: (chatId: number, loading: boolean) => void
  applyMessageOps: (chatId: number, ops: MessageOp[]) => void
  setReplyTo: (chatId: number, messageId: number | null) => void
  setTyping: (chatId: number, active: boolean) => void
  setEditing: (editing: EditingState | null) => void
  setToast: (message: string | null) => void
  setError: (message: string | null) => void
  setMediaUrl: (fileId: number, url: string) => void
  setMediaProgress: (fileId: number, progress: FileProgress, url?: string) => void
  setUnreadMarker: (chatId: number, marker: UnreadMarker | null) => void
  reset: () => void
}

function sortChats(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  })
}

function upsertMessage(list: Message[], message: Message): Message[] {
  const index = list.findIndex((item) => item.id === message.id)
  if (index === -1) return [...list, message]
  const next = [...list]
  next[index] = message
  return next
}

const EMPTY: Message[] = []

export const useAppStore = create<AppState>((set, get) => ({
  auth: { kind: 'idle' },
  connection: 'offline',
  info: null,
  theme: 'light',
  chats: [],
  activeChatId: null,
  messagesByChat: {},
  hasMoreByChat: {},
  loadingOlderByChat: {},
  loadingHistoryByChat: {},
  replyToByChat: {},
  typingByChat: {},
  editing: null,
  toast: null,
  error: null,
  mediaUrls: {},
  mediaProgress: {},
  unreadMarkers: {},

  setAuth: (auth) => set({ auth }),
  setConnection: (connection) => set({ connection }),
  setInfo: (info) => set({ info }),
  setTheme: (theme) => set({ theme }),
  setChats: (chats) => set({ chats: sortChats(chats) }),

  applyChatOps: (ops) => {
    const byId = new Map(get().chats.map((chat) => [chat.id, chat]))
    for (const op of ops) {
      if (op.op === 'upsert') byId.set(op.chat.id, op.chat)
      else byId.delete(op.chatId)
    }
    set({ chats: sortChats([...byId.values()]) })
  },

  setActiveChat: (activeChatId) => set({ activeChatId }),

  setHistory: (chatId, messages, hasMore) =>
    set((state) => ({
      messagesByChat: { ...state.messagesByChat, [chatId]: messages },
      hasMoreByChat: { ...state.hasMoreByChat, [chatId]: hasMore },
    })),

  prependHistory: (chatId, messages, hasMore) =>
    set((state) => {
      const existing = state.messagesByChat[chatId] ?? EMPTY
      const seen = new Set(existing.map((message) => message.id))
      const older = messages.filter((message) => !seen.has(message.id))
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: [...older, ...existing] },
        hasMoreByChat: { ...state.hasMoreByChat, [chatId]: hasMore },
      }
    }),

  setLoadingOlder: (chatId, loading) =>
    set((state) => ({ loadingOlderByChat: { ...state.loadingOlderByChat, [chatId]: loading } })),

  setLoadingHistory: (chatId, loading) =>
    set((state) => ({
      loadingHistoryByChat: { ...state.loadingHistoryByChat, [chatId]: loading },
    })),

  applyMessageOps: (chatId, ops) =>
    set((state) => {
      // Only a chat whose first page is already in memory may be patched here.
      // Creating an entry for a chat we never opened would make ChatPane's
      // "already cached" check believe the history is loaded and skip the fetch
      // entirely — read markers alone (`updateChatReadInbox` fires for every
      // chat) used to poison every conversation that way, which is what made
      // groups open empty and never page back.
      const existing = state.messagesByChat[chatId]
      if (existing === undefined) return {}
      let list = existing
      const deleted = new Set<number>()
      for (const op of ops) {
        switch (op.op) {
          case 'new':
            list = upsertMessage(list, op.message)
            break
          case 'edit':
            list = list.map((item) =>
              item.id === op.messageId ? { ...item, text: op.text, edited: true } : item,
            )
            break
          case 'replace':
            list = upsertMessage(list, op.message)
            break
          case 'delete':
            for (const id of op.messageIds) deleted.add(id)
            list = list.filter((item) => !op.messageIds.includes(item.id))
            break
          case 'read':
            break
          default:
            break
        }
      }

      let editing = state.editing
      if (editing && editing.chatId === chatId && deleted.has(editing.messageId)) editing = null

      let replyToByChat = state.replyToByChat
      const replyingTo = replyToByChat[chatId]
      if (replyingTo != null && deleted.has(replyingTo)) {
        replyToByChat = { ...replyToByChat, [chatId]: null }
      }

      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: list },
        editing,
        replyToByChat,
      }
    }),

  setReplyTo: (chatId, messageId) =>
    set((state) => ({ replyToByChat: { ...state.replyToByChat, [chatId]: messageId } })),

  setTyping: (chatId, active) =>
    set((state) => ({ typingByChat: { ...state.typingByChat, [chatId]: active } })),

  setEditing: (editing) => set({ editing }),
  setToast: (toast) => set({ toast }),
  setError: (error) => set({ error }),

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

  setUnreadMarker: (chatId, marker) =>
    set((state) => ({
      unreadMarkers: { ...state.unreadMarkers, [chatId]: marker },
    })),

  reset: () =>
    set({
      chats: [],
      activeChatId: null,
      messagesByChat: {},
      hasMoreByChat: {},
      loadingOlderByChat: {},
      loadingHistoryByChat: {},
      replyToByChat: {},
      editing: null,
      toast: null,
      error: null,
      mediaUrls: {},
      mediaProgress: {},
      unreadMarkers: {},
    }),
}))
