import { describe, expect, it } from 'vitest'

import type { MapperContext } from './map/context'
import { getStickerSet, listStickerSets } from './stickers'

function mapper(): MapperContext {
  return {
    chatTitles: new Map(),
    chatAvatarUrls: new Map(),
    userAvatarUrls: new Map(),
    stickerSizes: new Map(),
    resolveUserName: () => Promise.resolve(''),
    resolveChatTitle: () => Promise.resolve(''),
    prefetchUserAvatars: () => undefined,
  }
}

function deps(response: unknown) {
  return { invoke: () => Promise.resolve(response), mapper: mapper() }
}

describe('listStickerSets tab icon', () => {
  it('uses the set thumbnail when TDLib has one', async () => {
    const sets = await listStickerSets(
      deps({
        sets: [
          {
            id: 11,
            title: 'Cats',
            thumbnail: {
              file: { id: 90 },
              format: { _: 'thumbnailFormatWebp' },
              width: 100,
              height: 100,
            },
          },
        ],
      }),
    )
    expect(sets).toEqual([
      {
        id: '11',
        title: 'Cats',
        thumbnail: { fileId: 90, format: 'webp', width: 100, height: 100 },
      },
    ])
  })

  it('falls back to the first cover sticker, with its own thumbnail format', async () => {
    const sets = await listStickerSets(
      deps({
        sets: [
          {
            id: 12,
            title: 'Pets',
            thumbnail: null,
            covers: [
              {
                sticker: { id: 70 },
                format: { _: 'stickerFormatTgs' },
                width: 512,
                height: 512,
                thumbnail: { file: { id: 71 }, format: { _: 'thumbnailFormatWebp' } },
              },
            ],
          },
        ],
      }),
    )
    expect(sets[0]?.thumbnail).toEqual({
      fileId: 70,
      format: 'tgs',
      width: 512,
      height: 512,
      thumbFileId: 71,
      thumbFormat: 'webp',
    })
  })

  it('leaves the icon off when TDLib has neither a thumbnail nor a cover', async () => {
    const sets = await listStickerSets(
      deps({ sets: [{ id: 13, title: '贴吧', covers: [{ sticker: { id: 0 } }] }] }),
    )
    expect(sets).toEqual([{ id: '13', title: '贴吧' }])
  })
})

describe('getStickerSet tab icon', () => {
  it('falls back to the set first sticker', async () => {
    const set = await getStickerSet(
      deps({
        id: 14,
        title: 'Pets',
        thumbnail: null,
        stickers: [
          { sticker: { id: 80 }, format: { _: 'stickerFormatWebp' }, width: 64, height: 64 },
        ],
      }),
      '14',
    )
    expect(set.thumbnail).toEqual({ fileId: 80, format: 'webp', width: 64, height: 64 })
    expect(set.stickers).toHaveLength(1)
  })
})
