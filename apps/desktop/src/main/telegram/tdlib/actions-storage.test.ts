import { describe, expect, it } from 'vitest'

import { clearStorage, storageUsage, trimStorage } from './actions'
import type { ActionDeps } from './actions'
import type { TdObject } from './client'

function makeDeps(respond: (method: TdObject) => TdObject): {
  deps: Pick<ActionDeps, 'invoke'>
  calls: TdObject[]
} {
  const calls: TdObject[] = []
  return {
    calls,
    deps: {
      invoke: async (method) => {
        calls.push(method)
        return respond(method)
      },
    },
  }
}

/** The clearable file types 缓存上限 hands to `optimizeStorage`, in table order. */
const CLEARABLE = [
  { _: 'fileTypePhoto' },
  { _: 'fileTypeVideo' },
  { _: 'fileTypeVideoNote' },
  { _: 'fileTypeSticker' },
  { _: 'fileTypeAnimation' },
  { _: 'fileTypeDocument' },
  { _: 'fileTypeVoiceNote' },
  { _: 'fileTypeAudio' },
  { _: 'fileTypeLivePhotoVideo' },
  { _: 'fileTypeUnknown' },
]

/**
 * 数据与存储 is two TDLib calls: the per-type statistics the panel draws and one
 * `optimizeStorage` per write. What is pinned here is the file-type table (the
 * thing that makes 贴纸 clearable while thumbnails stay), that both writes ask for
 * the *deleted* statistics, and that 清理缓存 really passes every limit at 0
 * instead of TDLib's hold-back defaults.
 */
describe('storage actions', () => {
  it('splits the exact statistics into the five rows and ignores unclearable types', async () => {
    const { deps, calls } = makeDeps((method) =>
      method['_'] === 'getStorageStatistics'
        ? {
            _: 'storageStatistics',
            size: 1200,
            count: 16,
            by_chat: [
              {
                chat_id: 0,
                size: 1000,
                count: 12,
                by_file_type: [
                  { file_type: { _: 'fileTypePhoto' }, size: 100, count: 2 },
                  { file_type: { _: 'fileTypeVideoNote' }, size: 50, count: 1 },
                  // Not clearable: 清理缓存 must not count or delete it.
                  { file_type: { _: 'fileTypeThumbnail' }, size: 700, count: 9 },
                  { file_type: { _: 'fileTypeSticker' }, size: 30, count: 3 },
                ],
              },
              {
                chat_id: 7,
                size: 200,
                count: 4,
                by_file_type: [{ file_type: { _: 'fileTypePhoto' }, size: 20, count: 1 }],
              },
            ],
          }
        : { _: 'storageStatisticsFast', files_size: 1400, file_count: 20, database_size: 512 },
    )

    const usage = await storageUsage(deps)

    expect(calls).toEqual([
      { _: 'getStorageStatistics', chat_limit: 0 },
      { _: 'getStorageStatisticsFast' },
    ])
    expect(usage).toEqual({
      mediaSize: 200,
      mediaCount: 7,
      databaseSize: 512,
      buckets: [
        { kind: 'photo', size: 120, count: 3 },
        { kind: 'video', size: 50, count: 1 },
        { kind: 'sticker', size: 30, count: 3 },
      ],
    })
  })

  it('maps a missing field to zero and leaves an empty cache without rows', async () => {
    const { deps } = makeDeps((method) =>
      method['_'] === 'getStorageStatistics'
        ? { _: 'storageStatistics', by_chat: [] }
        : { _: 'storageStatisticsFast' },
    )

    await expect(storageUsage(deps)).resolves.toEqual({
      mediaSize: 0,
      mediaCount: 0,
      databaseSize: 0,
      buckets: [],
    })
  })

  it('trims to a byte ceiling over the clearable types and reports what was deleted', async () => {
    const { deps, calls } = makeDeps(() => ({
      _: 'storageStatistics',
      size: 700,
      count: 3,
      by_chat: [],
    }))

    await expect(trimStorage(deps, 1024.9)).resolves.toEqual({ bytes: 700, count: 3 })
    expect(calls).toEqual([
      {
        _: 'optimizeStorage',
        size: 1024,
        file_types: CLEARABLE,
        return_deleted_file_statistics: true,
      },
    ])
  })

  it('clears only the ticked kinds, with every limit at zero', async () => {
    const { deps, calls } = makeDeps(() => ({
      _: 'storageStatistics',
      size: 4096,
      count: 9,
      by_chat: [],
    }))

    await expect(clearStorage(deps, ['photo', 'sticker'])).resolves.toEqual({
      bytes: 4096,
      count: 9,
    })
    expect(calls).toEqual([
      {
        _: 'optimizeStorage',
        size: 0,
        ttl: 0,
        count: 0,
        immunity_delay: 0,
        file_types: [{ _: 'fileTypePhoto' }, { _: 'fileTypeSticker' }],
        return_deleted_file_statistics: true,
      },
    ])
  })

  it('does not call TDLib for an empty selection', async () => {
    const { deps, calls } = makeDeps(() => ({ _: 'storageStatistics', size: 1, count: 1 }))

    await expect(clearStorage(deps, [])).resolves.toEqual({ bytes: 0, count: 0 })
    expect(calls).toEqual([])
  })
})
