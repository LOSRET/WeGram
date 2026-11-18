import type { Sticker, StickerSet, StickerSetSummary } from '@wegram/protocol'

import type { TdObject } from './client'
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
  const sets: TdObject[] = Array.isArray(response?.sets) ? response.sets : []
  return sets.map((set) => {
    const cover = setCover(deps.mapper, set, Array.isArray(set?.covers) ? set.covers : [])
    return {
      id: String(set.id),
      title: set.title ?? '',
      ...(cover ? { thumbnail: cover } : {}),
    }
  })
}

export async function getStickerSet(deps: StickerDeps, setId: string): Promise<StickerSet> {
  const response = await deps.invoke({ _: 'getStickerSet', set_id: setId })
  const stickers: TdObject[] = Array.isArray(response?.stickers) ? response.stickers : []
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
