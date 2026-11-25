import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { AppError, MESSAGE_KIND_LABELS } from '@wegram/protocol'
import type { Message, MessageMedia } from '@wegram/protocol'

import type { MediaKind } from '@wegram/adapter-contract'
import type { MockAssets } from './assets'
import { mimeFromPath, MOCK_STICKER_SET_ID, type MockFile } from './constants'
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
  /**
   * A video's facts, injected the way the image probe is. Optional so the unit
   * tests' deps stay small: without it a sent clip is a row with no dimensions,
   * which is exactly the fallback the real adapter has for an unreadable file.
   */
  probeVideoMeta?: (filePath: string) => Promise<{
    width: number
    height: number
    duration: number
  } | null>
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
  const video =
    input.kind === 'video' ? ((await deps.probeVideoMeta?.(input.filePath)) ?? null) : null
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
    ...(video
      ? {
          width: video.width,
          height: video.height,
          ...(video.duration > 0 ? { duration: video.duration } : {}),
        }
      : {}),
  }
  const message = outgoingMessage({
    id: input.id,
    chatId: input.chatId,
    kind: input.kind === 'video' ? 'video' : input.kind === 'photo' && size ? 'photo' : 'file',
    text: input.caption ?? '',
    media,
    replyTo: input.replyTo,
  })
  const label = message.kind === 'photo' ? '图片' : message.kind === 'video' ? '视频' : '文件'
  return {
    message,
    preview: `[${label}] ${file.name}`,
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

/**
 * Builds the row a 语音消息 becomes.
 *
 * The clip is a real OGG file main just wrote from the renderer's recording, so
 * the bubble plays it through the same `wx-media://` registry as every other
 * outgoing file; `duration` is what the bubble prints.
 */
export async function buildVoiceMessage(
  deps: MockSendDeps,
  input: {
    id: number
    chatId: number
    filePath: string
    duration: number
    replyTo?: number
  },
): Promise<BuiltMedia> {
  const info = await stat(input.filePath)
  const fileId = deps.nextFileId()
  const file: MockFile = {
    fileId,
    path: input.filePath,
    url: deps.registerMedia(input.filePath),
    name: basename(input.filePath),
    size: info.size,
    mimeType: 'audio/ogg',
  }
  deps.assets.files.set(fileId, file)
  const message = outgoingMessage({
    id: input.id,
    chatId: input.chatId,
    kind: 'voice',
    text: '',
    media: {
      fileId,
      mimeType: file.mimeType ?? 'audio/ogg',
      duration: input.duration,
      size: info.size,
      localUrl: file.url,
    },
    replyTo: input.replyTo,
  })
  return { message, preview: MESSAGE_KIND_LABELS.voice, fileId, size: info.size }
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
      stickerSetId: MOCK_STICKER_SET_ID,
      ...(sticker.emoji ? { stickerEmoji: sticker.emoji } : {}),
      ...(sticker.width ? { width: sticker.width } : {}),
      ...(sticker.height ? { height: sticker.height } : {}),
      localUrl: file.url,
    },
    replyTo: input.replyTo,
  })
  return {
    message,
    preview: `${MESSAGE_KIND_LABELS.sticker} ${sticker.emoji ?? ''}`.trim(),
  }
}
