import { describe, expect, it } from 'vitest'

import { MockAssets } from './assets'
import { MOCK_STICKER_SET_ID } from './constants'
import { buildStickerMessage } from './media'

describe('mock sticker messages', () => {
  it('carries the pack id so a sticker comment can open its set box', () => {
    const assets = new MockAssets((path) => path)
    assets.files.set(7001, {
      fileId: 7001,
      path: 'sticker-face.webp',
      url: 'wx-media://sticker-face',
      name: 'sticker-face.webp',
      size: 100,
      mimeType: 'image/webp',
      width: 128,
      height: 128,
    })
    assets.stickers.push({
      fileId: 7001,
      format: 'webp',
      emoji: '😀',
      width: 128,
      height: 128,
      thumbFileId: 7001,
    })

    const built = buildStickerMessage({ assets }, { id: 900_001, chatId: 5, fileId: 7001 })

    expect(built.message.kind).toBe('sticker')
    expect(built.message.media).toMatchObject({
      fileId: 7001,
      stickerFormat: 'webp',
      stickerSetId: MOCK_STICKER_SET_ID,
    })
  })
})
