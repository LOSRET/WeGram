import type { Sticker } from '@wegram/protocol'

import type { TdObject } from '../client'

/** Set covers are thumbnails, not stickers, but they render through the same path. */
export function mapStickerThumbnail(thumbnail: TdObject): Sticker {
  const format: string | undefined = thumbnail?.format?._
  return {
    fileId: thumbnail?.file?.id ?? 0,
    format:
      format === 'thumbnailFormatTgs' ? 'tgs' : format === 'thumbnailFormatWebm' ? 'webm' : 'webp',
    ...(thumbnail?.width ? { width: thumbnail.width } : {}),
    ...(thumbnail?.height ? { height: thumbnail.height } : {}),
  }
}

export function mapStickerFormat(format: string | undefined): 'webp' | 'tgs' | 'webm' | undefined {
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
