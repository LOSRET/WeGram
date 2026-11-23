import { AppError } from '@wegram/protocol'
import type { CustomEmojiSticker, StickerSet, StickerSetSummary } from '@wegram/protocol'

import type { MockAssets } from './assets'
import { MOCK_STICKER_SET_ID } from './constants'

const TITLE = 'WeGram 贴纸'
/** The fixture set's `t.me/addstickers` name; the pack page copies it. */
const NAME = 'wegram'

/**
 * Whether the fixture set is installed and archived. The mock is one set, kept in
 * an object rather than on `MockAssets` because removing it must not make the
 * sticker artwork disappear from the transcript.
 */
export interface MockStickerSetState {
  installed: boolean
  archived: boolean
}

export function initialMockStickerSetState(): MockStickerSetState {
  return { installed: true, archived: false }
}

/**
 * The mock's installed sticker sets.
 *
 * Split out of `mock/index.ts` when the 通讯录 pushed that file to its size
 * budget; the real adapter keeps the same concern in `tdlib/stickers.ts`.
 */
export function listMockStickerSets(
  assets: MockAssets,
  state: MockStickerSetState,
): StickerSetSummary[] {
  // An archived set stays installed but leaves the panel, like TDLib's list.
  if (!state.installed || state.archived) return []
  const cover = assets.stickers[0]
  return [
    {
      id: MOCK_STICKER_SET_ID,
      title: TITLE,
      ...(cover ? { thumbnail: cover } : {}),
    },
  ]
}

/** Custom emoji art for the ids the fixture account names. */
export function listMockCustomEmoji(assets: MockAssets, ids: string[]): CustomEmojiSticker[] {
  return ids.flatMap((customEmojiId) => {
    const sticker = assets.customEmojis.get(customEmojiId)
    return sticker ? [{ customEmojiId, sticker }] : []
  })
}

export function getMockStickerSet(
  assets: MockAssets,
  state: MockStickerSetState,
  setId: string,
): StickerSet {
  if (setId !== MOCK_STICKER_SET_ID) {
    throw new AppError('internal', `Unknown sticker set ${setId}`)
  }
  const cover = assets.stickers[0]
  return {
    id: MOCK_STICKER_SET_ID,
    title: TITLE,
    name: NAME,
    isInstalled: state.installed,
    isArchived: state.archived,
    ...(cover ? { thumbnail: cover } : {}),
    stickers: assets.stickers.map((sticker) => ({ ...sticker })),
  }
}

/** The pack page's 移除 / 归档, kept in the session only (nothing persists). */
export function changeMockStickerSet(
  state: MockStickerSetState,
  setId: string,
  change: { installed: boolean; archived?: boolean },
): void {
  if (setId !== MOCK_STICKER_SET_ID) {
    throw new AppError('internal', `Unknown sticker set ${setId}`)
  }
  if (!change.installed) {
    state.installed = false
    state.archived = false
    return
  }
  state.installed = true
  state.archived = change.archived === true
}
