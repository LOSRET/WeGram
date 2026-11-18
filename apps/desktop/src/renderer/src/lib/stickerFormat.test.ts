import { describe, expect, it } from 'vitest'

import { resolveStickerFormat } from './stickerFormat'

describe('resolveStickerFormat', () => {
  it('uses the sticker format outside the picker', () => {
    expect(resolveStickerFormat({ stickerFormat: 'tgs' }, false)).toBe('tgs')
    expect(
      resolveStickerFormat(
        { stickerFormat: 'webm', stickerThumbFormat: 'webp', thumbFileId: 9 },
        false,
      ),
    ).toBe('webm')
  })

  it('uses the thumbnail format when the picker has a thumbnail', () => {
    expect(
      resolveStickerFormat(
        { stickerFormat: 'tgs', stickerThumbFormat: 'webp', thumbFileId: 9 },
        true,
      ),
    ).toBe('webp')
    expect(
      resolveStickerFormat(
        { stickerFormat: 'webm', stickerThumbFormat: 'webp', thumbFileId: 9 },
        true,
      ),
    ).toBe('webp')
  })

  it('defaults a thumbnail to a static picture when its format is unknown', () => {
    expect(resolveStickerFormat({ stickerFormat: 'tgs', thumbFileId: 9 }, true)).toBe('webp')
  })

  it('keeps the sticker format when the picker has to draw the sticker itself', () => {
    expect(resolveStickerFormat({ stickerFormat: 'tgs' }, true)).toBe('tgs')
    expect(resolveStickerFormat({ stickerFormat: 'webm', thumbFileId: 0 }, true)).toBe('webm')
  })

  it('falls back to webp when the adapter knows no format', () => {
    expect(resolveStickerFormat({}, false)).toBe('webp')
  })
})
