import type { MessageMedia, StickerFormat } from '@wegram/protocol'

/** The parts of a sticker's media that decide how it is drawn. */
type StickerMedia = Pick<MessageMedia, 'stickerFormat' | 'stickerThumbFormat' | 'thumbFileId'>

/**
 * Which renderer a sticker needs.
 *
 * The picker paints the thumbnail (thumbFileId), and TDLib serves that thumbnail as
 * a static image even when the sticker itself is a TGS animation or a WebM video.
 * Reusing the sticker's format there sent a WebP through lottie-web (gzip decode
 * threw, so the cell fell back to its emoji) or through <video> (MEDIA_ERR_SRC_NOT
 * SUPPORTED, videoWidth 0, so the cell stayed blank): whole animated packs looked
 * unloadable in the 表情 panel while the chat bubbles were fine.
 *
 * Without a distinct thumbnail the cell draws the sticker file itself, which is why
 * that case keeps the sticker's own format.
 */
export function resolveStickerFormat(media: StickerMedia, preview: boolean): StickerFormat {
  const stickerFormat = media.stickerFormat ?? 'webp'
  if (!preview) return stickerFormat
  const hasThumbnail = media.thumbFileId !== undefined && media.thumbFileId > 0
  if (!hasThumbnail) return stickerFormat
  return media.stickerThumbFormat ?? 'webp'
}
