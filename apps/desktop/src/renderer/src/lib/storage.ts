import type { StorageMediaBucket } from '@wegram/protocol'

/**
 * 数据与存储's display arithmetic, kept out of the panel so `pnpm test` can pin it.
 *
 * The numbers themselves always come from main; these two helpers only decide how
 * the rows and the clear button write them.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * A cache size the way the official 清理缓存 dialog writes it: one decimal for
 * every unit above bytes (309.4 MB), no trailing ".0", and "0 B" for an empty
 * row. The shared media formatter rounds for progress readouts, which is why this
 * one lives here instead.
 */
export function formatStorageSize(bytes: number): string {
  if (!(bytes > 0)) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  if (unit === 0) return `${Math.round(value)} B`
  return `${value.toFixed(1).replace(/\.0$/, '')} ${UNITS[unit]}`
}

/** What a set of ticked rows adds up to — the byte count in the clear button. */
export function sumBucketSizes(buckets: readonly StorageMediaBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.size), 0)
}

/**
 * A row's share of the clearable media, the way the official 清理缓存 dialog
 * writes it: whole percent, rounded, clamped to 0–100.
 *
 * A tiny row that rounds to 0 is drawn without a percentage rather than as "0%";
 * the caller checks for 0.
 */
export function cacheShare(size: number, total: number): number {
  if (!(size > 0) || !(total > 0)) return 0
  return Math.min(100, Math.max(0, Math.round((size / total) * 100)))
}
