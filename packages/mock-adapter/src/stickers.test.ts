import { describe, expect, it } from 'vitest'

import { MOCK_STICKER_SET_ID } from './constants'
import { changeMockStickerSet, initialMockStickerSetState } from './stickers'

/**
 * The fixture pack's install flags. The box's 移除 / 添加 / 归档 are UI writes with
 * no server behind them in the mock, so this is the whole state machine.
 */
describe('changeMockStickerSet', () => {
  it('removes the pack and clears its archived flag', () => {
    const state = initialMockStickerSetState()
    changeMockStickerSet(state, MOCK_STICKER_SET_ID, { installed: false })
    expect(state).toEqual({ installed: false, archived: false })
  })

  it('archives an installed pack', () => {
    const state = initialMockStickerSetState()
    changeMockStickerSet(state, MOCK_STICKER_SET_ID, { installed: true, archived: true })
    expect(state).toEqual({ installed: true, archived: true })
  })

  it('adding an archived pack unarchives it', () => {
    const state = { installed: true, archived: true }
    changeMockStickerSet(state, MOCK_STICKER_SET_ID, { installed: true })
    expect(state).toEqual({ installed: true, archived: false })
  })

  it('refuses a set the fixture account does not own', () => {
    const state = initialMockStickerSetState()
    expect(() => changeMockStickerSet(state, 'other', { installed: false })).toThrow()
  })
})
