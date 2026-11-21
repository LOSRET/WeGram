import { nextReadState } from '@wegram/mock-session'
import { AppError } from '@wegram/protocol'

import type { AdapterEvent } from '@wegram/adapter-contract'
import type { Fixture, MockFile } from './constants'

type Emit = (event: AdapterEvent) => void

/**
 * Marks everything up to `upToMessageId` read the way TDLib does: the marker only
 * moves forward and `unread` is whatever is still newer than it. Reporting the
 * marker (instead of always "0 unread") is what lets the renderer watch the chat
 * row and the rail badge fall message by message while the reader scrolls.
 */
export function applyRead(
  deps: { fixtures: Map<number, Fixture>; emit: Emit },
  chatId: number,
  upToMessageId?: number,
): void {
  const fixture = deps.fixtures.get(chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${chatId}`)
  const state = nextReadState(fixture.chat, fixture.messages, upToMessageId)
  if (!state) return
  fixture.chat.lastReadInboxMessageId = state.lastReadInboxMessageId
  fixture.chat.unread = state.unread
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
}

/** Drives `evt:file` so progress bars have something real to render. */
export async function simulateTransfer(
  deps: { files: Map<number, MockFile>; emit: Emit },
  fileId: number,
  total: number,
  uploading: boolean,
): Promise<void> {
  const steps = [0.12, 0.38, 0.71]
  for (const step of steps) {
    await new Promise((resolve) => setTimeout(resolve, 180))
    deps.emit({
      type: 'file',
      fileId,
      downloaded: Math.round(total * step),
      total,
      ...(uploading ? { uploading: true } : {}),
    })
  }
  const file = deps.files.get(fileId)
  await new Promise((resolve) => setTimeout(resolve, 180))
  deps.emit({
    type: 'file',
    fileId,
    downloaded: total,
    total,
    ...(file ? { url: file.url } : {}),
    ...(uploading ? { uploading: true } : {}),
    completed: true,
  })
}
