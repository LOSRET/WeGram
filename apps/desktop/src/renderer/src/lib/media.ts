import type { MessageMedia } from '@wechatgram/protocol'
import { useEffect } from 'react'

import { useAppStore, type FileProgress } from '../store/useAppStore'
import { invoke } from './ipc'

/**
 * One download per file, shared by every row that shows it.
 *
 * Rows are virtualised and re-mounted on every scroll, so without this map a
 * single photo could start several downloads while it is being scrolled in and
 * out. TDLib does coalesce them, but the renderer would still wait on duplicate
 * IPC round-trips.
 */
const inFlight = new Map<number, Promise<string>>()

export function ensureMedia(fileId: number, priority = 8): Promise<string> {
  if (fileId <= 0) return Promise.reject(new Error('invalid file id'))
  const cached = useAppStore.getState().mediaUrls[fileId]
  if (cached) return Promise.resolve(cached)

  const running = inFlight.get(fileId)
  if (running) return running

  const promise = invoke('media:download', { fileId, priority })
    .then(({ url }) => {
      useAppStore.getState().setMediaUrl(fileId, url)
      return url
    })
    .finally(() => inFlight.delete(fileId))
  inFlight.set(fileId, promise)
  return promise
}

/** Resolved `wx-media://` URL for a file, downloading it on first sight. */
export function useMediaUrl(media: MessageMedia | undefined, priority = 8): string | undefined {
  const fileId = media?.fileId ?? 0
  const stored = useAppStore((state) => (fileId ? state.mediaUrls[fileId] : undefined))
  const url = stored ?? media?.localUrl

  useEffect(() => {
    if (!media || media.fileId <= 0 || url) return
    void ensureMedia(media.fileId, priority).catch(() => undefined)
  }, [media, priority, url])

  return url
}

export function useFileProgress(fileId: number | undefined): FileProgress | undefined {
  return useAppStore((state) => (fileId ? state.mediaProgress[fileId] : undefined))
}

export function progressRatio(progress: FileProgress | undefined): number | undefined {
  if (!progress || progress.total <= 0) return undefined
  return Math.min(1, Math.max(0, progress.downloaded / progress.total))
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
