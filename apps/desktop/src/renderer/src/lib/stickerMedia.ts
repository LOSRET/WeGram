import type { MessageMedia, Sticker } from '@wegram/protocol'

/**
 * A sticker as the media of a message.
 *
 * The picker renders the thumbnail and the transcript the full file, so both
 * file ids and both formats travel together: TDLib serves a static WebP/JPEG
 * thumbnail even for TGS/WebM stickers, and a grid that reused `format` would
 * try to play an animation it does not have.
 */
export function stickerMedia(sticker: Sticker): MessageMedia {
  return {
    fileId: sticker.fileId,
    ...(sticker.thumbFileId ? { thumbFileId: sticker.thumbFileId } : {}),
    ...(sticker.thumbFormat ? { stickerThumbFormat: sticker.thumbFormat } : {}),
    stickerFormat: sticker.format,
    ...(sticker.emoji ? { stickerEmoji: sticker.emoji } : {}),
    ...(sticker.width ? { width: sticker.width } : {}),
    ...(sticker.height ? { height: sticker.height } : {}),
  }
}
