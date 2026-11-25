import type { CacheLimit } from '@wegram/protocol'

/**
 * 数据与存储's one pure rule (design doc §9.11.3): the ceiling a {@link CacheLimit}
 * stands for.
 *
 * It lives outside the IPC handlers and the panel so `pnpm test` can pin it, and
 * so a new step is one row here rather than a data migration.
 */

const MB = 1024 * 1024

/**
 * 缓存上限 → the byte ceiling `optimizeStorage` takes, or `null` for "never trim".
 *
 * The protocol's ids are the words on the panel; the bytes belong here.
 */
export function cacheLimitBytes(limit: CacheLimit): number | null {
  switch (limit) {
    case 'unlimited':
      return null
    case '512mb':
      return 512 * MB
    case '1gb':
      return 1024 * MB
    case '2gb':
      return 2048 * MB
    case '5gb':
      return 5120 * MB
  }
}
