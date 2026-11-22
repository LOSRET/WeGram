import type { Message } from '@wegram/protocol'
import { AppError } from '@wegram/protocol'

import type { AdapterEvent, MediaKind } from '@wegram/adapter-contract'
import type { MockAssets } from './assets'
import type { Fixture } from './constants'
import { simulateTransfer } from './effects'
import {
  buildAlbumMessages,
  buildMediaMessage,
  buildStickerMessage,
  buildVoiceMessage,
  type MockSendDeps,
} from './media'
import { appendMessage, outgoingMessage } from './transcript'

/**
 * The mock's outgoing messages: text, one media file, an album (相册) and a sticker.
 *
 * Split out of `index.ts` when that class reached its line budget. Every send
 * builds a row, appends it to the fixture's transcript and starts the fake upload,
 * so the renderer exercises the same "send then progress" path the TDLib adapter
 * produces.
 */
export interface MockSendStore {
  fixtures: Map<number, Fixture>
  assets: MockAssets
  emit(event: AdapterEvent): void
  /** The builders' injected dependencies (media registry, image probe, file ids). */
  sendDeps(): MockSendDeps
  takeMessageId(): number
  /**
   * `WEGRAM_MOCK_FAIL_SEND=1`: report the next text send as failed once, so the
   * 未发送 row and 重试 can be exercised without a network.
   */
  failNextSend(): boolean
}

export function createMockSends(store: MockSendStore) {
  const requireFixture = (chatId: number): Fixture => {
    const fixture = store.fixtures.get(chatId)
    if (!fixture) throw new AppError('internal', `Unknown mock chat ${chatId}`)
    return fixture
  }

  const append = (fixture: Fixture, message: Message, preview: string): void => {
    appendMessage({ emit: (event) => store.emit(event) }, fixture, message, preview)
  }

  const upload = (fileId: number, size: number): void => {
    // Upload progress is reported asynchronously, like TDLib does.
    void simulateTransfer(
      { files: store.assets.files, emit: (event) => store.emit(event) },
      fileId,
      size,
      true,
    )
  }

  const sendText = async (input: {
    chatId: number
    text: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> => {
    const fixture = requireFixture(input.chatId)
    const message = outgoingMessage({
      id: store.takeMessageId(),
      chatId: input.chatId,
      kind: 'text',
      text: input.text,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    })
    if (store.failNextSend()) {
      // The dev-only 未发送 fixture: TDLib's own shape for a refused send.
      message.sendingState = 'failed'
      message.sendError = '网络连接中断（模拟）'
      message.canRetry = true
    }
    append(fixture, message, input.text)
    return { localId: `mock-${message.id}`, message }
  }

  const sendMedia = async (input: {
    chatId: number
    filePath: string
    kind: MediaKind
    caption?: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> => {
    const fixture = requireFixture(input.chatId)
    const built = await buildMediaMessage(store.sendDeps(), {
      ...input,
      id: store.takeMessageId(),
    })
    append(fixture, built.message, built.preview)
    upload(built.fileId, built.size)
    return { localId: `mock-${built.message.id}`, message: built.message }
  }

  /**
   * 相册: 2–10 files as one album. Every row carries the same album id, which is
   * what the transcript folds; the fixture peer sees one upload per item.
   */
  const sendAlbum = async (input: {
    chatId: number
    items: Array<{ filePath: string; kind: MediaKind; caption?: string }>
    replyTo?: number
  }): Promise<{ localIds: string[]; messages: Message[] }> => {
    const fixture = requireFixture(input.chatId)
    const built = await buildAlbumMessages(store.sendDeps(), {
      chatId: input.chatId,
      // The album is identified by this send, not by its first message id.
      albumId: `mock-album-${store.takeMessageId()}`,
      items: input.items,
      takeId: () => store.takeMessageId(),
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    })
    for (const item of built) {
      append(fixture, item.message, item.preview)
      upload(item.fileId, item.size)
    }
    return {
      localIds: built.map((item) => `mock-${item.message.id}`),
      messages: built.map((item) => item.message),
    }
  }

  /**
   * 语音消息: the OGG main wrote from the renderer's recording. The row is a voice
   * bubble with its duration and a real local file, so playback goes through the
   * same registry as every other outgoing media.
   */
  const sendVoice = async (input: {
    chatId: number
    filePath: string
    duration: number
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> => {
    const fixture = requireFixture(input.chatId)
    const built = await buildVoiceMessage(store.sendDeps(), {
      ...input,
      id: store.takeMessageId(),
    })
    append(fixture, built.message, built.preview)
    upload(built.fileId, built.size)
    return { localId: `mock-${built.message.id}`, message: built.message }
  }

  const sendSticker = async (input: {
    chatId: number
    fileId: number
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> => {
    const fixture = requireFixture(input.chatId)
    const built = buildStickerMessage(store.sendDeps(), {
      ...input,
      id: store.takeMessageId(),
    })
    append(fixture, built.message, built.preview)
    return { localId: `mock-${built.message.id}`, message: built.message }
  }

  return { sendText, sendMedia, sendAlbum, sendSticker, sendVoice }
}
