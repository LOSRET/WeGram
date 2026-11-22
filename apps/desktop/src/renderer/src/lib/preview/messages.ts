import { nextReadState, pageAround, pageNewer, pageOlder } from '@wegram/mock-session'
import type { ChatSummary, EventChannel, Message } from '@wegram/protocol'

import { editTargetOf } from '../editTarget'

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

/**
 * 转文字 in the browser preview: the fake transcript TDLib would stream — the row
 * first goes `pending`, then carries the finished text, both as `replace` ops so
 * the real content-update path is what the UI exercises.
 */
export function previewTranscribe(
  store: PreviewMessagesStore,
  chatId: number,
  messageId: number,
): void {
  const target = (store.messagesByChat[chatId] ?? []).find((item) => item.id === messageId)
  if (!target) throw { code: 'internal', message: 'message not found' }
  const script = '这是一段演示语音的转写结果，用来检查转文字的状态流转。'
  target.transcription = { status: 'pending' }
  store.emit('evt:messages', { chatId, ops: [{ op: 'replace', message: { ...target } }] })
  window.setTimeout(() => {
    target.transcription = { status: 'done', text: script }
    store.emit('evt:messages', { chatId, ops: [{ op: 'replace', message: { ...target } }] })
  }, 900)
}

/**
 * `messages:properties` in the preview: the same capability question the TDLib
 * adapter asks, answered from what the fixture row is. Text rows can be edited,
 * a voice note can be transcribed, everything else behaves like TDLib's defaults.
 */
export function previewMessageProperties(
  store: PreviewMessagesStore,
  chatId: number,
  messageId: number,
): {
  canBeEdited: boolean
  canBeForwarded: boolean
  canBeDeletedOnlyForSelf: boolean
  canBeDeletedForAllUsers: boolean
  canBeCopied: boolean
  canBeReplied: boolean
  canRecognizeSpeech: boolean
} {
  const target = (store.messagesByChat[chatId] ?? []).find((item) => item.id === messageId)
  if (!target) throw { code: 'internal', message: 'message not found' }
  return {
    // Text edits and 编辑说明 are different calls but share TDLib's flag; the
    // row's own kind decides which one the menu offers (`lib/editTarget.ts`).
    canBeEdited: target.outgoing && editTargetOf(target) !== null,
    canBeForwarded: true,
    canBeDeletedOnlyForSelf: true,
    canBeDeletedForAllUsers: target.outgoing,
    canBeCopied: target.text.length > 0,
    canBeReplied: true,
    canRecognizeSpeech: target.kind === 'voice',
  }
}
