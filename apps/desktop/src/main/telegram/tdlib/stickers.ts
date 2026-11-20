import type { CustomEmojiSticker, Sticker, StickerSet, StickerSetSummary } from '@wegram/protocol'

import type { TdObject } from './client'
import { asArray } from './json'
import type { MapperContext } from './map/context'
import { mapStickerFormat, mapStickerThumbnail, mapStickerThumbnailFormat } from './map/sticker'

export interface StickerDeps {
  invoke(method: TdObject): Promise<any>
  mapper: MapperContext
}

export async function listStickerSets(deps: StickerDeps): Promise<StickerSetSummary[]> {
  const response = await deps.invoke({
    _: 'getInstalledStickerSets',
    sticker_type: { _: 'stickerTypeRegular' },
  })
  const sets: TdObject[] = asArray(response?.sets)
  return sets.map((set) => {
    const cover = setCover(deps.mapper, set, asArray(set?.covers))
    return {
      id: String(set.id),
      title: set.title ?? '',
      ...(cover ? { thumbnail: cover } : {}),
    }
  })
}

export async function getStickerSet(deps: StickerDeps, setId: string): Promise<StickerSet> {
  const response = await deps.invoke({ _: 'getStickerSet', set_id: setId })
  const stickers: TdObject[] = asArray(response?.stickers)
  const cover = setCover(deps.mapper, response, stickers)
  return {
    id: String(response.id),
    title: response.title ?? '',
    ...(cover ? { thumbnail: cover } : {}),
    stickers: stickers
      .map((sticker) => toSticker(deps.mapper, sticker))
      .filter((item) => item.fileId > 0),
  }
}

/**
 * Custom emoji art: TDLib answers only the ids it knows, in arbitrary order, so
 * the sticker's own `full_type.custom_emoji_id` is what pairs it back with the
 * text entity. A custom emoji has no set, no emoji and no thumbnail here.
 */
export async function listCustomEmojiStickers(
  deps: StickerDeps,
  ids: string[],
): Promise<CustomEmojiSticker[]> {
  if (ids.length === 0) return []
  const response = await deps.invoke({ _: 'getCustomEmojiStickers', custom_emoji_ids: ids })
  const stickers: TdObject[] = asArray(response?.stickers)
  const result: CustomEmojiSticker[] = []
  for (const raw of stickers) {
    // The id is int64 on both sides; comparing it as a string is the only safe read.
    const customEmojiId = raw?.full_type?.custom_emoji_id
    if (customEmojiId === undefined || customEmojiId === null || customEmojiId === '') continue
    const sticker = toSticker(deps.mapper, raw)
    if (sticker.fileId > 0) result.push({ customEmojiId: String(customEmojiId), sticker })
  }
  return result
}

/**
 * The picture on a set's tab.
 *
 * TDLib's installed list ships `covers` — the set's first stickers — while its own
 * `thumbnail` is often null (measured on the real account: only 2 of the visible 8
 * tabs had one, the rest fell back to two characters of the title). Official
 * clients resolve it the same way: tdesktop's `StickersSet::lookupThumbnailDocument`
 * tries the set thumbnail, then the first sticker, then `covers.front()`.
 */
function setCover(ctx: MapperContext, raw: TdObject, fallback: TdObject[]): Sticker | undefined {
  if (raw?.thumbnail?.file?.id) return mapStickerThumbnail(raw.thumbnail)
  for (const sticker of fallback) {
    const mapped = toSticker(ctx, sticker)
    if (mapped.fileId > 0) return mapped
  }
  return undefined
}

/** One sticker of a set; caches its pixel size so sending needs no lookup. */
function toSticker(ctx: MapperContext, raw: TdObject): Sticker {
  const fileId: number = raw?.sticker?.id ?? 0
  const thumbFileId: number = raw?.thumbnail?.file?.id ?? 0
  if (fileId && raw?.width && raw?.height) {
    ctx.stickerSizes.set(fileId, { width: raw.width, height: raw.height })
  }
  return {
    fileId,
    format: mapStickerFormat(raw?.format?._) ?? 'webp',
    ...(raw?.emoji ? { emoji: raw.emoji } : {}),
    ...(raw?.width ? { width: raw.width } : {}),
    ...(raw?.height ? { height: raw.height } : {}),
    // The thumbnail's format is not the sticker's: TDLib serves a static WebP
    // preview even for a TGS/WebM sticker, so the picker must know both.
    ...(thumbFileId > 0
      ? { thumbFileId, thumbFormat: mapStickerThumbnailFormat(raw?.thumbnail?.format?._) }
      : {}),
  }
}
