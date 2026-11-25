import type {
  StorageFreed,
  StorageMediaBucket,
  StorageMediaKind,
  StorageUsage,
} from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import type { ActionDeps } from './deps'

/**
 * 数据与存储 (design doc §9.11.3). TDLib owns the file cache: nothing in this app
 * deletes a downloaded file by hand, so the settings group reads TDLib's own
 * statistics and lets TDLib delete by its own rule.
 *
 * The rows are the official client's five kinds. Each one is a set of TDLib file
 * types ({@link KIND_FILE_TYPES}); passing those lists explicitly to
 * `optimizeStorage` is both what makes 贴纸和表情符号 clearable and what keeps
 * thumbnails, profile photos and wallpapers out of the deletion.
 */

/** The order the panel draws, and the order buckets come back in. */
const MEDIA_KINDS: readonly StorageMediaKind[] = ['photo', 'video', 'sticker', 'animation', 'other']

/**
 * TDLib's own default deletion set excludes thumbnails, profile photos, stickers
 * and wallpapers. An explicit list is required for the kinds the dialog offers,
 * and leaving the other types out of it is what makes the exclusion hold.
 */
const KIND_FILE_TYPES: Record<StorageMediaKind, readonly TdObject[]> = {
  photo: [{ _: 'fileTypePhoto' }],
  video: [{ _: 'fileTypeVideo' }, { _: 'fileTypeVideoNote' }],
  sticker: [{ _: 'fileTypeSticker' }],
  animation: [{ _: 'fileTypeAnimation' }],
  other: [
    { _: 'fileTypeDocument' },
    { _: 'fileTypeVoiceNote' },
    { _: 'fileTypeAudio' },
    { _: 'fileTypeLivePhotoVideo' },
    { _: 'fileTypeUnknown' },
  ],
}

/** file type name → its row, built from the one table so both directions agree. */
const KIND_BY_FILE_TYPE = new Map<string, StorageMediaKind>()
for (const kind of MEDIA_KINDS) {
  for (const fileType of KIND_FILE_TYPES[kind]) {
    if (typeof fileType['_'] === 'string') KIND_BY_FILE_TYPE.set(fileType['_'], kind)
  }
}

/** Every clearable kind, for 缓存上限 (which bounds the media the panel shows). */
const CLEARABLE_FILE_TYPES: TdObject[] = MEDIA_KINDS.flatMap((kind) => [...KIND_FILE_TYPES[kind]])

/** A TDLib number as a non-negative finite one; a missing field means zero. */
function size(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * `getStorageStatistics` + `getStorageStatisticsFast` → the protocol's usage.
 *
 * The exact answer is walked per chat and per file type, because that is the only
 * split TDLib offers; the database size (which the panel also shows) is not part
 * of it and comes from the fast call. Pure, pinned by a test.
 */
export function mapStorageUsage(
  stats: TdObject | undefined,
  fast: TdObject | undefined,
): StorageUsage {
  const totals = new Map<StorageMediaKind, { size: number; count: number }>()
  for (const chat of asArray<TdObject>(stats?.by_chat)) {
    for (const entry of asArray<TdObject>(chat?.by_file_type)) {
      const fileType: unknown = entry?.file_type?.['_']
      if (typeof fileType !== 'string') continue
      const kind = KIND_BY_FILE_TYPE.get(fileType)
      if (!kind) continue
      const current = totals.get(kind) ?? { size: 0, count: 0 }
      current.size += size(entry?.size)
      current.count += Math.floor(size(entry?.count))
      totals.set(kind, current)
    }
  }

  const buckets: StorageMediaBucket[] = []
  for (const kind of MEDIA_KINDS) {
    const total = totals.get(kind)
    if (!total || total.size <= 0) continue
    buckets.push({ kind, ...total })
  }

  return {
    mediaSize: buckets.reduce((sum, bucket) => sum + bucket.size, 0),
    mediaCount: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    databaseSize: size(fast?.database_size),
    buckets,
  }
}

export async function storageUsage(deps: Pick<ActionDeps, 'invoke'>): Promise<StorageUsage> {
  const [stats, fast] = await Promise.all([
    // chat_limit 0: one aggregate entry, which is all the panel draws. A per-chat
    // table would be the 存储空间 → 会话 page, which this client does not have.
    deps.invoke({ _: 'getStorageStatistics', chat_limit: 0 }),
    deps.invoke({ _: 'getStorageStatisticsFast' }),
  ])
  return mapStorageUsage(stats, fast)
}

/**
 * One `optimizeStorage` call, answering what TDLib deleted.
 *
 * `return_deleted_file_statistics` is what makes the answer usable: without it
 * TDLib returns the whole remaining cache, which cannot tell a trim that freed
 * 2 GB from one that freed nothing.
 */
async function optimize(
  deps: Pick<ActionDeps, 'invoke'>,
  limits: {
    size?: number
    ttl?: number
    count?: number
    immunity_delay?: number
    file_types?: TdObject[]
  },
): Promise<StorageFreed> {
  const deleted = await deps.invoke({
    _: 'optimizeStorage',
    ...limits,
    return_deleted_file_statistics: true,
  })
  return { bytes: size(deleted?.size), count: Math.floor(size(deleted?.count)) }
}

/** 缓存上限: leave `maxBytes` of clearable media behind. */
export function trimStorage(
  deps: Pick<ActionDeps, 'invoke'>,
  maxBytes: number,
): Promise<StorageFreed> {
  return optimize(deps, {
    size: Math.max(0, Math.floor(maxBytes)),
    file_types: CLEARABLE_FILE_TYPES,
  })
}

/**
 * 清理缓存 for the ticked kinds. `ttl: 0` and `immunity_delay: 0` make it one
 * immediate pass, where TDLib's defaults would hold back files created recently;
 * `size`/`count` of 0 is "nothing left of these types".
 */
export function clearStorage(
  deps: Pick<ActionDeps, 'invoke'>,
  kinds: StorageMediaKind[],
): Promise<StorageFreed> {
  const fileTypes = new Map<string, TdObject>()
  for (const kind of kinds) {
    for (const fileType of KIND_FILE_TYPES[kind]) {
      if (typeof fileType['_'] === 'string') fileTypes.set(fileType['_'], fileType)
    }
  }
  if (fileTypes.size === 0) return Promise.resolve({ bytes: 0, count: 0 })
  return optimize(deps, {
    size: 0,
    ttl: 0,
    count: 0,
    immunity_delay: 0,
    file_types: [...fileTypes.values()],
  })
}
