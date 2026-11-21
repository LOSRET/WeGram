import type { MessageMedia } from '@wegram/protocol'
import { useEffect, useRef } from 'react'

import { useAppStore, type FileProgress } from '../store/useAppStore'
import { invoke } from './ipc'

/**
 * One request per owner still in flight.
 *
 * Rows are virtualised and re-mounted on every scroll, so without this map one
 * hook instance could start several IPC round-trips for its picture while it is
 * being scrolled. It is keyed by owner, not by file, on purpose: two windows
 * showing the same photo must each hold their own lease in main, or the bubble
 * leaving would cancel the transfer the viewer is waiting for.
 */
const inFlight = new Map<string, Promise<string>>()

/**
 * Who is waiting for which file.
 *
 * Main counts holders per file, so the same photo shown by a bubble and by the
 * 图片和视频 window is one transfer, and either one leaving cancels nothing. An
 * owner is one hook instance (a bubble's picture, a viewer item) or one isolated
 * request (an emoji's click sound).
 */
const heldByOwner = new Map<string, number>()
const releaseTimers = new Map<string, number>()

/**
 * How long a dropped holder waits before its cancel is sent.
 *
 * A StrictMode remount — and a virtualised row that scrolls back — runs unmount
 * then mount in the same commit; cancelling synchronously would kill the very
 * transfer the remount is about to wait for. A quarter second is invisible to
 * the reader and long enough for the remount to re-hold the file.
 */
const RELEASE_GRACE_MS = 250

let ownerSeq = 0

/** A fresh owner for one hook instance or one isolated request. */
export function nextOwner(prefix = 'media'): string {
  ownerSeq += 1
  return `${prefix}-${ownerSeq}`
}

function clearRelease(owner: string): void {
  const timer = releaseTimers.get(owner)
  if (timer === undefined) return
  window.clearTimeout(timer)
  releaseTimers.delete(owner)
}

/**
 * Drops an owner's interest in its file. The cancel reaches main only after the
 * grace period, and only if the same owner has not asked for that file again.
 */
export function releaseMedia(owner: string, immediate = false): void {
  const fileId = heldByOwner.get(owner)
  if (fileId === undefined) return
  heldByOwner.delete(owner)

  const send = (): void => {
    releaseTimers.delete(owner)
    if (heldByOwner.get(owner) === fileId) return
    void invoke('media:cancel', { fileId, owner }).catch(() => undefined)
  }

  clearRelease(owner)
  if (immediate) {
    send()
    return
  }
  releaseTimers.set(owner, window.setTimeout(send, RELEASE_GRACE_MS))
}

/**
 * Downloads a file once and answers its `wx-media://` URL.
 *
 * `owner` names this call site, so `releaseMedia` can drop its interest without
 * touching another window's download of the same file.
 */
export function ensureMedia(fileId: number, priority: number, owner: string): Promise<string> {
  if (fileId <= 0) return Promise.reject(new Error('invalid file id'))
  const cached = useAppStore.getState().mediaUrls[fileId]
  if (cached) return Promise.resolve(cached)

  const previous = heldByOwner.get(owner)
  if (previous !== undefined && previous !== fileId) releaseMedia(owner, true)
  clearRelease(owner)
  heldByOwner.set(owner, fileId)

  const running = inFlight.get(owner)
  if (running) return running

  const promise = invoke('media:download', { fileId, priority, owner })
    .then(({ url }) => {
      useAppStore.getState().setMediaUrl(fileId, url)
      return url
    })
    .finally(() => inFlight.delete(owner))
  inFlight.set(owner, promise)
  return promise
}

/**
 * A `wx-media://` URL for a video the element plays while it downloads: main
 * registers the file id for the streaming handler (design doc §8.7), so the clip
 * starts seconds after the click instead of after the whole transfer.
 *
 * The owner is recorded exactly like a download's: an inline GIF that scrolls
 * away (or a viewer that pages on) releases it, and the tail stops once no other
 * holder wants the file.
 */
export async function streamMedia(fileId: number, owner: string): Promise<string> {
  if (fileId <= 0) return Promise.reject(new Error('invalid file id'))
  const previous = heldByOwner.get(owner)
  if (previous !== undefined && previous !== fileId) releaseMedia(owner, true)
  clearRelease(owner)
  heldByOwner.set(owner, fileId)
  try {
    const { url } = await invoke('media:stream', { fileId, owner })
    return url
  } catch (error) {
    releaseMedia(owner, true)
    throw error
  }
}

/**
 * Resolved `wx-media://` URL for a file, downloading it on first sight.
 *
 * `enabled` holds the download back until the caller's element is close to the
 * viewport: a sticker set is a hundred cells but only a screenful is ever read,
 * and asking TDLib for all hundred at once starves the request slots. The same
 * gate keeps a transcript's photos from all downloading at once.
 */
export function useMediaUrl(
  media: MessageMedia | undefined,
  priority = 8,
  enabled = true,
): string | undefined {
  const fileId = media?.fileId ?? 0
  const stored = useAppStore((state) => (fileId ? state.mediaUrls[fileId] : undefined))
  const url = stored ?? media?.localUrl
  const ownerRef = useRef('')
  if (!ownerRef.current) ownerRef.current = nextOwner('url')

  useEffect(() => {
    const owner = ownerRef.current
    if (!enabled || !media || media.fileId <= 0 || url) return
    void ensureMedia(media.fileId, priority, owner).catch(() => undefined)
  }, [media, priority, url, enabled])

  // Leaving the preload margin (or having the file) drops this holder's
  // interest, which is what stops a photo that scrolled away from downloading.
  useEffect(() => {
    const owner = ownerRef.current
    if (!enabled || url) releaseMedia(owner)
  }, [enabled, url])

  // A virtualised row unmounts when it leaves the window entirely.
  useEffect(() => {
    const owner = ownerRef.current
    return () => releaseMedia(owner)
  }, [])

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
