import type {
  StorageFreed,
  StorageMediaBucket,
  StorageMediaKind,
  StorageUsage,
} from '@wegram/protocol'

/**
 * 数据与存储's demo cache, shared by the Electron mock adapter and the browser
 * preview so both show the same numbers.
 *
 * The sizes mirror the official client's 清理缓存 example — four kinds, about
 * 537 MB of media, 96 MB of database — so the panel's percentages look like the
 * reference UI. Nothing on disk is involved: clearing moves these numbers only,
 * and the generated fixture media under `userData/mock-media` is untouched.
 */

const DEMO_DATABASE_SIZE = 100_663_296

const DEMO_BUCKETS: readonly StorageMediaBucket[] = [
  { kind: 'photo', size: 324_429_414, count: 412 },
  { kind: 'sticker', size: 154_035_046, count: 88 },
  { kind: 'animation', size: 524_288, count: 6 },
  { kind: 'other', size: 83_780_454, count: 140 },
]

function withBuckets(usage: StorageUsage, buckets: readonly StorageMediaBucket[]): StorageUsage {
  return {
    mediaSize: buckets.reduce((sum, bucket) => sum + bucket.size, 0),
    mediaCount: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    databaseSize: usage.databaseSize,
    buckets: buckets.map((bucket) => ({ ...bucket })),
  }
}

/** A fresh copy, so a caller mutating its state cannot rewrite the fixture. */
export function initialMockStorage(): StorageUsage {
  return {
    mediaSize: DEMO_BUCKETS.reduce((sum, bucket) => sum + bucket.size, 0),
    mediaCount: DEMO_BUCKETS.reduce((sum, bucket) => sum + bucket.count, 0),
    databaseSize: DEMO_DATABASE_SIZE,
    buckets: DEMO_BUCKETS.map((bucket) => ({ ...bucket })),
  }
}

/**
 * 缓存上限 on the fake cache: shrink every kind proportionally (TDLib deletes
 * individual files by last use, which crosses the rows) and report what went.
 */
export function trimMockStorage(
  usage: StorageUsage,
  maxBytes: number,
): { usage: StorageUsage; freed: StorageFreed } {
  const total = usage.mediaSize
  if (total <= maxBytes) return { usage: withBuckets(usage, usage.buckets), freed: zeroFreed() }

  const target = Math.max(0, Math.floor(maxBytes))
  const exact = usage.buckets.map((bucket) => (bucket.size * target) / total)
  const sizes = exact.map((value) => Math.floor(value))
  let remainder = target - sizes.reduce((sum, value) => sum + value, 0)
  const byRemainder = usage.buckets
    .map((bucket, index) => ({
      index,
      fraction: (exact[index] ?? 0) - (sizes[index] ?? 0),
      room: bucket.size - (sizes[index] ?? 0),
    }))
    .sort((a, b) => b.fraction - a.fraction)
  for (const candidate of byRemainder) {
    if (remainder <= 0) break
    if (candidate.room <= 0) continue
    sizes[candidate.index] = (sizes[candidate.index] ?? 0) + 1
    remainder -= 1
  }

  const buckets: StorageMediaBucket[] = []
  for (const [index, bucket] of usage.buckets.entries()) {
    const size = sizes[index] ?? 0
    if (size <= 0) continue
    const count =
      size >= bucket.size
        ? bucket.count
        : Math.min(bucket.count, Math.round(bucket.count * (size / bucket.size)))
    buckets.push({ kind: bucket.kind, size, count })
  }

  const next = withBuckets(usage, buckets)
  return {
    usage: next,
    freed: {
      bytes: usage.mediaSize - next.mediaSize,
      count: usage.mediaCount - next.mediaCount,
    },
  }
}

/** 清理缓存 for the ticked kinds: drop those rows and report what they held. */
export function clearMockStorage(
  usage: StorageUsage,
  kinds: readonly StorageMediaKind[],
): { usage: StorageUsage; freed: StorageFreed } {
  const selected = new Set(kinds)
  const kept = usage.buckets.filter((bucket) => !selected.has(bucket.kind))
  const removed = usage.buckets.filter((bucket) => selected.has(bucket.kind))
  return {
    usage: withBuckets(usage, kept),
    freed: {
      bytes: removed.reduce((sum, bucket) => sum + bucket.size, 0),
      count: removed.reduce((sum, bucket) => sum + bucket.count, 0),
    },
  }
}

function zeroFreed(): StorageFreed {
  return { bytes: 0, count: 0 }
}
