import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { AppError } from '@wegram/protocol'
import type { Message, MessageMedia } from '@wegram/protocol'

import type { MediaKind } from '@wegram/adapter-contract'
import type { MockAssets } from './assets'
import { mimeFromPath, type MockFile } from './constants'
import { outgoingMessage } from './transcript'

/**
 * The mock's outgoing media and stickers.
 *
 * A chat's send and a comment thread's post build the same rows — a comment
 * carries whatever the composer produced (design doc §9.8) — so the construction
 * lives here once. The caller decides where the row lands (the transcript or a
 * comment thread) and whether to simulate its upload.
 */

export interface MockSendDeps {
  assets: MockAssets
  registerMedia: (filePath: string) => string
  probeImageSize: (filePath: string) => Promise<{ width: number; height: number } | null>
  nextFileId: () => number
}

/** A built row plus what the caller needs to append and report it. */
export interface BuiltMessage {
  message: Message
  /** What the conversation row shows under the title. */
  preview: string
}

export interface BuiltMedia extends BuiltMessage {
  /** The file the upload progress belongs to. */
  fileId: number
  /** Bytes to report: the upload simulation streams this much. */
  size: number
}

/** Registers a local file and builds the row that carries it. */
export async function buildMediaMessage(
  deps: MockSendDeps,
  input: {
    id: number
    chatId: number
    filePath: string
    kind: MediaKind
    caption?: string
    replyTo?: number
  },
): Promise<BuiltMedia> {
  const info = await stat(input.filePath)
  const size = input.kind === 'photo' ? await deps.probeImageSize(input.filePath) : null
  const fileId = deps.nextFileId()
  const file: MockFile = {
    fileId,
    path: input.filePath,
    url: deps.registerMedia(input.filePath),
    name: basename(input.filePath),
    size: info.size,
    mimeType: mimeFromPath(input.filePath),
    ...(size ?? {}),
  }
  deps.assets.files.set(fileId, file)

  const media: MessageMedia = {
    fileId,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
    fileName: file.name,
    size: file.size,
    localUrl: file.url,
    ...(size ? { width: size.width, height: size.height } : {}),
  }
  const message = outgoingMessage({
    id: input.id,
    chatId: input.chatId,
    kind: input.kind === 'photo' && size ? 'photo' : 'file',
    text: input.caption ?? '',
    media,
    replyTo: input.replyTo,
  })
  return {
    message,
    preview: `[${message.kind === 'photo' ? '图片' : '文件'}] ${file.name}`,
    fileId,
    size: info.size,
  }
}

/**
 * Builds the rows of one album (相册). Telegram keys them by `media_album_id`,
 * so every row carries the same id and the transcript folds them into one bubble;
 * the ids come from the caller's counter, like a real send.
 */
export async function buildAlbumMessages(
  deps: MockSendDeps,
  input: {
    chatId: number
    albumId: string
    items: Array<{ filePath: string; kind: MediaKind; caption?: string }>
    takeId: () => number
    replyTo?: number
  },
): Promise<BuiltMedia[]> {
  const built: BuiltMedia[] = []
  for (const item of input.items) {
    const row = await buildMediaMessage(deps, {
      ...item,
      id: input.takeId(),
      chatId: input.chatId,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    })
    built.push({ ...row, message: { ...row.message, albumId: input.albumId } })
  }
  return built
}

/** Builds the row a sticker from the picker becomes. */
export function buildStickerMessage(
  deps: Pick<MockSendDeps, 'assets'>,
  input: { id: number; chatId: number; fileId: number; replyTo?: number },
): BuiltMessage {
  const sticker = deps.assets.stickers.find((item) => item.fileId === input.fileId)
  const file = deps.assets.files.get(input.fileId)
  if (!sticker || !file) throw new AppError('internal', `Unknown mock sticker ${input.fileId}`)
  const message = outgoingMessage({
    id: input.id,
    chatId: input.chatId,
    kind: 'sticker',
    text: '',
    media: {
      fileId: sticker.fileId,
      stickerFormat: sticker.format,
      ...(sticker.emoji ? { stickerEmoji: sticker.emoji } : {}),
      ...(sticker.width ? { width: sticker.width } : {}),
      ...(sticker.height ? { height: sticker.height } : {}),
      localUrl: file.url,
    },
    replyTo: input.replyTo,
  })
  return { message, preview: `[贴纸] ${sticker.emoji ?? ''}`.trim() }
}
