import { z } from 'zod'

/**
 * 数据与存储 (design doc §9.11.3): the local cache TDLib keeps for this account.
 *
 * TDLib owns those files — WeGram never deletes one itself, and the unused
 * `media_cache` LRU table in `ui.db` stays unused — so the panel only paints
 * TDLib's own statistics and asks it to trim. The ceiling itself is a property of
 * this machine rather than of the account, which is why it lives in `ui.db`.
 *
 * The cache is partitioned the way the official client's 清理缓存 dialog
 * partitions it: photos, videos, stickers, GIFs and the rest. A kind is a set of
 * TDLib file types (the adapter owns that table); the renderer only ever sees
 * tickable kinds.
 */

export const storageMediaKindSchema = z.enum(['photo', 'video', 'sticker', 'animation', 'other'])
export type StorageMediaKind = z.infer<typeof storageMediaKindSchema>

/** One tickable row of 清理缓存. */
export const storageMediaBucketSchema = z.object({
  kind: storageMediaKindSchema,
  /** Bytes of this kind currently in the cache. */
  size: z.number().nonnegative(),
  /** How many files that is. */
  count: z.number().int().nonnegative(),
})
export type StorageMediaBucket = z.infer<typeof storageMediaBucketSchema>

/**
 * What the 存储空间 rows paint, from TDLib's exact `getStorageStatistics` (the
 * per-type split the official dialog shows) plus the database size from the fast
 * statistics.
 *
 * `mediaSize`/`mediaCount` are the sum of {@link buckets} — the five **clearable**
 * kinds. Thumbnails, profile photos and wallpapers are deliberately outside them:
 * TDLib never lets 清理缓存 delete that artwork, so counting it would make the
 * button promise space it cannot free.
 */
export const storageUsageSchema = z.object({
  mediaSize: z.number().nonnegative(),
  mediaCount: z.number().int().nonnegative(),
  databaseSize: z.number().nonnegative(),
  /** Non-empty kinds only, in the client's order: photo, video, sticker, animation, other. */
  buckets: z.array(storageMediaBucketSchema).max(5),
})
export type StorageUsage = z.infer<typeof storageUsageSchema>

/**
 * 缓存上限: the ceiling 数据与存储 puts on downloaded media. `unlimited` is the
 * default and the behaviour every install had before this group existed — an
 * update must never start deleting a cache on its own.
 */
export const cacheLimitSchema = z.enum(['unlimited', '512mb', '1gb', '2gb', '5gb'])
export type CacheLimit = z.infer<typeof cacheLimitSchema>

/** What `storage:get` answers: the current usage and the ceiling in force. */
export const storageStateSchema = z.object({
  usage: storageUsageSchema,
  limit: cacheLimitSchema,
})
export type StorageState = z.infer<typeof storageStateSchema>

/**
 * What one `optimizeStorage` reclaimed.
 *
 * TDLib reports deleted files as a size and a count, never as file ids, so the
 * panel cannot refresh one bubble after a trim; `evt:mediaCleared` drops every
 * cached URL instead.
 */
export const storageFreedSchema = z.object({
  bytes: z.number().nonnegative(),
  count: z.number().int().nonnegative(),
})
export type StorageFreed = z.infer<typeof storageFreedSchema>

/**
 * The 数据与存储 channels, in their own table like `network.ts`.
 *
 * `storage:setLimit` trims at once when the new ceiling is below what is on disk.
 * `storage:clear` takes the ticked kinds, so 清理缓存 is the official dialog's
 * per-type clear and not an all-or-nothing wipe. Both answer the state after the
 * write — an exact statistics read, because a per-type row cannot be patched from
 * an aggregate number.
 */
export const storageInvokeChannels = ['storage:get', 'storage:setLimit', 'storage:clear'] as const

export const storageInvokeSchemas = {
  'storage:get': { request: z.void(), response: storageStateSchema },
  'storage:setLimit': {
    request: z.object({ limit: cacheLimitSchema }),
    response: storageStateSchema,
  },
  'storage:clear': {
    request: z.object({ kinds: z.array(storageMediaKindSchema).min(1).max(5) }),
    response: z.object({
      freedBytes: z.number().nonnegative(),
      state: storageStateSchema,
    }),
  },
}
