import type { Sticker, StickerSet, StickerSetSummary } from '@wechatgram/protocol'

import type { TdObject } from './client'
import type { MapperContext } from './map/context'
import { mapStickerFormat, mapStickerThumbnail } from './map/sticker'

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
  return sets.map((set) => ({
    id: String(set.id),
    title: set.title ?? '',
    ...(set.thumbnail ? { thumbnail: mapStickerThumbnail(set.thumbnail) } : {}),
  }))
}

export async function getStickerSet(deps: StickerDeps, setId: string): Promise<StickerSet> {
  const response = await deps.invoke({ _: 'getStickerSet', set_id: setId })
  const stickers: TdObject[] = Array.isArray(response?.stickers) ? response.stickers : []
  return {
    id: String(response.id),
    title: response.title ?? '',
    ...(response.thumbnail ? { thumbnail: mapStickerThumbnail(response.thumbnail) } : {}),
    stickers: stickers
      .map((sticker) => toSticker(deps.mapper, sticker))
      .filter((item) => item.fileId > 0),
  }
}

/** One sticker of a set; caches its pixel size so sending needs no lookup. */
function toSticker(ctx: MapperContext, raw: TdObject): Sticker {
  const fileId: number = raw?.sticker?.id ?? 0
  if (fileId && raw?.width && raw?.height) {
    ctx.stickerSizes.set(fileId, { width: raw.width, height: raw.height })
  }
  return {
    fileId,
    format: mapStickerFormat(raw?.format?._) ?? 'webp',
    ...(raw?.emoji ? { emoji: raw.emoji } : {}),
    ...(raw?.width ? { width: raw.width } : {}),
    ...(raw?.height ? { height: raw.height } : {}),
    ...(raw?.thumbnail?.file?.id ? { thumbFileId: raw.thumbnail.file.id } : {}),
  }
}
