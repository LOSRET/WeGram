import type { MessageMedia } from '@wegram/protocol'

import { registerMediaFile } from '../../../media/registry'
import type { TdObject } from '../client'
import { asArray } from '../json'

/**
 * Shared by the message mapper (`mapContent`) and the rich-message mapper: both
 * read the same TDLib objects and must produce identical `MessageMedia`.
 *
 * That identity is the point: a field added for one mapper (a new thumbnail
 * size, a spoiler-safe placeholder) has to land for the other in the same edit,
 * which a second copy of the spread cannot guarantee.
 *
 * A builder answers `fileId: 0` when TDLib gave it no file; callers that need a
 * drawable item check the id and drop it (see `rich.ts` `asMedia`).
 */

export function mediaUrls(
  file: TdObject | undefined,
  thumb?: TdObject | undefined,
): { localUrl?: string; thumbUrl?: string } {
  const localUrl = mediaFileUrl(file)
  const thumbUrl = mediaFileUrl(thumb)
  return {
    ...(localUrl ? { localUrl } : {}),
    ...(thumbUrl ? { thumbUrl } : {}),
  }
}

/**
 * `wx-media://` for a file TDLib has already downloaded. Shared with the sticker
 * mapper, whose premium effect is a *second* file that rides in its own DTO field
 * instead of `localUrl`/`thumbUrl`.
 */
export function mediaFileUrl(file: TdObject | undefined): string | undefined {
  const local = file?.local
  if (!local?.is_downloading_completed) return undefined
  if (typeof local.path !== 'string' || local.path.length === 0) return undefined
  return registerMediaFile(local.path)
}

/** A photo object (`messagePhoto.photo`, `pageBlockPhoto.photo`). */
export function photoMedia(photo: TdObject | undefined): MessageMedia {
  const sizes: TdObject[] = asArray(photo?.sizes)
  const display = pickLargest(sizes)
  // A small variant doubles as the bubble placeholder until the full file lands.
  const thumb = pickSmallestAtLeast(sizes, 160) ?? display
  const thumbFileId = Number(thumb?.photo?.id ?? 0)
  /**
   * Every size, smallest first: the bubble downloads the one that covers its box
   * and the viewer asks for the largest (see `lib/mediaVariant.ts`). Without the
   * table the renderer can only ask for `fileId`, i.e. the original — which is
   * exactly the 1280 px download a 240 px bubble should not need.
   */
  const variants = sizes
    .map((size) => ({
      fileId: Number(size?.photo?.id ?? 0),
      width: Number(size?.width ?? 0),
      height: Number(size?.height ?? 0),
    }))
    .filter((size) => size.fileId > 0 && size.width > 0 && size.height > 0)
    .sort((a, b) => a.width * a.height - b.width * b.height)
  return {
    fileId: Number(display?.photo?.id ?? 0),
    ...(thumb !== display && thumbFileId ? { thumbFileId } : {}),
    ...(display?.width ? { width: Number(display.width) } : {}),
    ...(display?.height ? { height: Number(display.height) } : {}),
    ...(variants.length > 0 ? { sizes: variants } : {}),
    ...(photo?.minithumbnail?.data ? { minithumbnail: photo.minithumbnail.data } : {}),
    ...mediaUrls(display?.photo, thumb?.photo),
  }
}

/**
 * A video or an animation. The two TDLib objects differ only in the name of
 * their file field, so one builder with `field` keeps the field table single.
 */
export function videoMedia(
  value: TdObject | undefined,
  field: 'video' | 'animation',
): MessageMedia {
  const file = value?.[field]
  return {
    fileId: Number(file?.id ?? 0),
    ...(value?.thumbnail?.file?.id ? { thumbFileId: Number(value.thumbnail.file.id) } : {}),
    ...(value?.duration ? { duration: Number(value.duration) } : {}),
    ...(value?.width ? { width: Number(value.width) } : {}),
    ...(value?.height ? { height: Number(value.height) } : {}),
    ...(typeof value?.file_name === 'string' && value.file_name
      ? { fileName: value.file_name }
      : {}),
    ...(typeof value?.mime_type === 'string' && value.mime_type
      ? { mimeType: value.mime_type }
      : {}),
    ...(value?.minithumbnail?.data ? { minithumbnail: value.minithumbnail.data } : {}),
    ...mediaUrls(file, value?.thumbnail?.file),
  }
}

/**
 * A document or an audio file. Pages carry the audio variant, so the file field
 * is whichever of the two exists; `title` is the audio page's name.
 */
export function documentMedia(value: TdObject | undefined): MessageMedia {
  const file = value?.document ?? value?.audio
  const fileName = value?.file_name ?? value?.title
  return {
    fileId: Number(file?.id ?? 0),
    ...(value?.thumbnail?.file?.id ? { thumbFileId: Number(value.thumbnail.file.id) } : {}),
    ...(typeof fileName === 'string' && fileName ? { fileName } : {}),
    ...(file?.size ? { size: Number(file.size) } : {}),
    ...(typeof value?.mime_type === 'string' && value.mime_type
      ? { mimeType: value.mime_type }
      : {}),
    ...(value?.minithumbnail?.data ? { minithumbnail: value.minithumbnail.data } : {}),
    ...mediaUrls(file, value?.thumbnail?.file),
  }
}

/** A voice note; TDLib sometimes omits the MIME type, and ogg is the default. */
export function voiceMedia(value: TdObject | undefined): MessageMedia {
  return {
    fileId: Number(value?.voice?.id ?? 0),
    mimeType: value?.mime_type ?? 'audio/ogg',
    ...(value?.duration ? { duration: Number(value.duration) } : {}),
    ...mediaUrls(value?.voice),
  }
}

export function pickLargest(sizes: TdObject[]): TdObject | undefined {
  return sizes.reduce<TdObject | undefined>((best, size) => {
    if (!best) return size
    const area = (size.width ?? 0) * (size.height ?? 0)
    const bestArea = (best.width ?? 0) * (best.height ?? 0)
    return area > bestArea ? size : best
  }, undefined)
}

export function pickSmallestAtLeast(sizes: TdObject[], minWidth: number): TdObject | undefined {
  return [...sizes]
    .filter((size) => (size.width ?? 0) >= minWidth)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0]
}
