import { AppError } from '@wegram/protocol'
import type { StickerSet, StickerSetSummary } from '@wegram/protocol'

import type { MockAssets } from './assets'
import { MOCK_STICKER_SET_ID } from './constants'

const TITLE = 'WeGram 贴纸'

/**
 * The mock's installed sticker sets.
 *
 * Split out of `mock/index.ts` when the 通讯录 pushed that file to its 550-line
 * budget; the real adapter keeps the same concern in `tdlib/stickers.ts`.
 */
export function listMockStickerSets(assets: MockAssets): StickerSetSummary[] {
  const cover = assets.stickers[0]
  return [
    {
      id: MOCK_STICKER_SET_ID,
      title: TITLE,
      ...(cover ? { thumbnail: cover } : {}),
    },
  ]
}

export function getMockStickerSet(assets: MockAssets, setId: string): StickerSet {
  if (setId !== MOCK_STICKER_SET_ID) {
    throw new AppError('internal', `Unknown sticker set ${setId}`)
  }
  const cover = assets.stickers[0]
  return {
    id: MOCK_STICKER_SET_ID,
    title: TITLE,
    ...(cover ? { thumbnail: cover } : {}),
    stickers: assets.stickers.map((sticker) => ({ ...sticker })),
  }
}
