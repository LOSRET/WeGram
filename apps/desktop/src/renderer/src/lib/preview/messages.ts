import { nextReadState, pageAround, pageNewer, pageOlder } from '@wegram/mock-session'
import type { ChatSummary, EventChannel, Message } from '@wegram/protocol'

/**
 * The preview's transcript rules (design doc §6.3, §7.2), split out of
 * `preview/index.ts` when that file reached its size budget.
 *
 * They are the mock adapter's own helpers from `@wegram/mock-session`, applied to
 * the preview's mutable session: the read marker only moves forward, and paging
 * is the three window queries the shell asks for.
 */
export interface PreviewMessagesStore {
  chats: ChatSummary[]
  messagesByChat: Record<number, Message[]>
  emit(channel: EventChannel, payload: unknown): void
}

/**
 * The adapter's read rule in three lines: the marker only moves forward, and
 * `unread` is whatever is still newer than it. `upTo === null` means "the newest
 * message" (`chats:open`).
 */
export function previewMarkRead(
  store: PreviewMessagesStore,
  chatId: number,
  upTo: number | null,
): void {
  const chat = store.chats.find((item) => item.id === chatId)
  if (!chat) return
  const state = nextReadState(chat, store.messagesByChat[chatId] ?? [], upTo ?? undefined)
  if (!state) return
  chat.lastReadInboxMessageId = state.lastReadInboxMessageId
  chat.unread = state.unread
  store.emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
}

export interface PreviewHistoryQuery {
  chatId: number
  fromMessageId?: number
  limit: number
}

export interface PreviewAroundQuery {
  chatId: number
  messageId: number
  limit: number
}

export interface PreviewNewerQuery {
  chatId: number
  fromMessageId: number
  limit: number
}

export function previewHistory(
  store: PreviewMessagesStore,
  input: PreviewHistoryQuery,
): ReturnType<typeof pageOlder> {
  return pageOlder(store.messagesByChat[input.chatId] ?? [], input.fromMessageId, input.limit)
}

export function previewAround(
  store: PreviewMessagesStore,
  input: PreviewAroundQuery,
): ReturnType<typeof pageAround> {
  return pageAround(store.messagesByChat[input.chatId] ?? [], input.messageId, input.limit)
}

export function previewNewer(
  store: PreviewMessagesStore,
  input: PreviewNewerQuery,
): ReturnType<typeof pageNewer> {
  return pageNewer(store.messagesByChat[input.chatId] ?? [], input.fromMessageId, input.limit)
}
