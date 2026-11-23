import { describe, expect, it } from 'vitest'

import type { MapperContext } from './map/context'
import {
  changeStickerSet,
  getStickerSet,
  listCustomEmojiStickers,
  listStickerSets,
} from './stickers'

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

describe('listCustomEmojiStickers', () => {
  it('pairs each sticker with the id its own full_type carries', async () => {
    const stickers = await listCustomEmojiStickers(
      deps({
        stickers: [
          {
            sticker: { id: 501 },
            format: { _: 'stickerFormatTgs' },
            width: 512,
            height: 512,
            full_type: {
              _: 'stickerFullTypeCustomEmoji',
              // Real custom emoji ids are int64 and outgrow Number.MAX_SAFE_INTEGER.
              custom_emoji_id: '5909018290759408000',
              needs_repainting: false,
            },
          },
          // An id TDLib does not know comes back without a full_type; it is dropped.
          { sticker: { id: 0 }, format: { _: 'stickerFormatWebp' } },
        ],
      }),
      ['5909018290759408000', '1'],
    )

    expect(stickers).toEqual([
      {
        customEmojiId: '5909018290759408000',
        sticker: { fileId: 501, format: 'tgs', width: 512, height: 512 },
      },
    ])
  })

  it('asks TDLib for nothing when there are no ids', async () => {
    let called = false
    const stickers = await listCustomEmojiStickers(
      {
        invoke: () => {
          called = true
          return Promise.resolve({})
        },
        mapper: mapper(),
      },
      [],
    )
    expect(stickers).toEqual([])
    expect(called).toBe(false)
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

  it('carries the t.me/addstickers name and the install flags', async () => {
    const set = await getStickerSet(
      deps({
        id: 15,
        title: 'Deepseek Chan @zhaxia_cn',
        name: 'deepseek',
        is_installed: true,
        is_archived: false,
        thumbnail: null,
        stickers: [],
      }),
      '15',
    )
    // The pack page copies this name into https://t.me/addstickers/<name>.
    expect(set).toMatchObject({ name: 'deepseek', isInstalled: true, isArchived: false })
  })

  it('leaves the name off when TDLib has none', async () => {
    const set = await getStickerSet(
      deps({ id: 16, title: '本地贴纸', name: '', stickers: [] }),
      '16',
    )
    expect(set).not.toHaveProperty('name')
    expect(set.isInstalled).toBe(false)
    expect(set.isArchived).toBe(false)
  })
})

describe('changeStickerSet', () => {
  function recordingDeps() {
    const calls: Array<Record<string, unknown>> = []
    return {
      calls,
      deps: {
        invoke: (method: Record<string, unknown>) => {
          calls.push(method)
          return Promise.resolve({ _: 'ok' })
        },
        mapper: mapper(),
      },
    }
  }

  it('files 归档贴纸 as installed + archived', async () => {
    const { calls, deps: stickerDeps } = recordingDeps()
    await changeStickerSet(stickerDeps, '15', { installed: true, archived: true })
    expect(calls).toEqual([
      { _: 'changeStickerSet', set_id: '15', is_installed: true, is_archived: true },
    ])
  })

  it('removes 移除贴纸包 with is_installed false', async () => {
    const { calls, deps: stickerDeps } = recordingDeps()
    await changeStickerSet(stickerDeps, '15', { installed: false })
    expect(calls).toEqual([
      { _: 'changeStickerSet', set_id: '15', is_installed: false, is_archived: false },
    ])
  })
})
