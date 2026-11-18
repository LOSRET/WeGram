import type { Sticker, StickerFormat } from '@wegram/protocol'

import type { TdObject } from '../client'

/**
 * The renderer's three sticker formats, from a TDLib `thumbnailFormat*` name.
 *
 * Only TGS and WebM/Mpeg4 thumbnails are animations; every other thumbnail
 * format (WebP, JPEG, PNG, GIF) is a picture, and so is an unknown one — measured
 * on this account: a TGS sticker's thumbnail file is served as a static WebP and a
 * WebM sticker's thumbnail likewise (`content-type: image/webp`).
 */
export function mapStickerThumbnailFormat(format: string | undefined): StickerFormat {
  switch (format) {
    case 'thumbnailFormatTgs':
      return 'tgs'
    case 'thumbnailFormatWebm':
    case 'thumbnailFormatMpeg4':
      return 'webm'
    default:
      return 'webp'
  }
}

/** Set covers are thumbnails, not stickers, but they render through the same path. */
export function mapStickerThumbnail(thumbnail: TdObject): Sticker {
  return {
    fileId: thumbnail?.file?.id ?? 0,
    format: mapStickerThumbnailFormat(thumbnail?.format?._),
    ...(thumbnail?.width ? { width: thumbnail.width } : {}),
    ...(thumbnail?.height ? { height: thumbnail.height } : {}),
  }
}

export function mapStickerFormat(format: string | undefined): StickerFormat | undefined {
  switch (format) {
    case 'stickerFormatWebp':
      return 'webp'
    case 'stickerFormatTgs':
      return 'tgs'
    case 'stickerFormatWebm':
      return 'webm'
    default:
      return undefined
  }
}
