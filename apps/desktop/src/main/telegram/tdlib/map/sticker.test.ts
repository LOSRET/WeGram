import { describe, expect, it } from 'vitest'

import { mapStickerFormat, mapStickerThumbnail } from './sticker'

describe('mapStickerFormat', () => {
  it('maps the three sticker formats', () => {
    expect(mapStickerFormat('stickerFormatWebp')).toBe('webp')
    expect(mapStickerFormat('stickerFormatTgs')).toBe('tgs')
    expect(mapStickerFormat('stickerFormatWebm')).toBe('webm')
  })

  it('returns undefined for unknown formats so the caller can default', () => {
    expect(mapStickerFormat('stickerFormatAnimated')).toBeUndefined()
    expect(mapStickerFormat(undefined)).toBeUndefined()
  })
})

describe('mapStickerThumbnail', () => {
  it('maps a set cover to the sticker shape the picker renders', () => {
    expect(
      mapStickerThumbnail({
        file: { id: 77 },
        width: 100,
        height: 100,
        format: { _: 'thumbnailFormatTgs' },
      }),
    ).toEqual({ fileId: 77, format: 'tgs', width: 100, height: 100 })
  })

  it('reads the TDLib thumbnail format names', () => {
    expect(
      mapStickerThumbnail({ file: { id: 1 }, format: { _: 'thumbnailFormatWebm' } }),
    ).toMatchObject({ format: 'webm' })
    expect(
      mapStickerThumbnail({ file: { id: 1 }, format: { _: 'thumbnailFormatWebp' } }),
    ).toMatchObject({ format: 'webp' })
    expect(mapStickerThumbnail({ file: { id: 1 } })).toMatchObject({ format: 'webp' })
  })
})
