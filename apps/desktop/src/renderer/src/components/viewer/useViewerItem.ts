import type { ViewerItem } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'

import { errorMessage } from '../../lib/ipc'
import { ensureMedia, nextOwner, releaseMedia, streamMedia } from '../../lib/media'
import { MEDIA_PRIORITY } from '../../lib/mediaPriority'
import { pickVariant } from '../../lib/mediaVariant'

export interface ViewerItemSource {
  /** What the window paints: a photo's file, or a video's stream. */
  url: string | null
  /** The bubble's thumbnail, painted while the full picture downloads. */
  previewUrl: string | null
  loadError: string | null
  /** Download ratio while a photo arrives; null once it is here. */
  progress: number | null
}

/**
 * The current item at the viewer's priority, following its progress.
 *
 * Two files, like the official client's viewer: the thumbnail the transcript
 * already had is painted first, and the full picture replaces it once it lands —
 * the canvas is never blank while the original downloads. A video is not
 * downloaded at all: `media:stream` hands out a URL the scheme handler tails
 * (design doc §8.7), so playback starts while TDLib is still fetching.
 *
 * The owners are per window instance, not per effect run: a StrictMode remount
 * re-uses them, so its cleanup never cancels the transfer the remount waits for.
 */
export function useViewerItem(item: ViewerItem | undefined): ViewerItemSource {
  const fileId = item?.fileId ?? 0
  const video = item?.kind === 'video'
  const [url, setUrl] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  /** The file actually transferring: a photo's chosen variant, or the clip. */
  const [downloadingId, setDownloadingId] = useState(0)

  const ownersRef = useRef<{ preview: string; primary: string } | null>(null)
  if (!ownersRef.current) {
    ownersRef.current = { preview: nextOwner('viewer-preview'), primary: nextOwner('viewer') }
  }
  const owners = ownersRef.current

  useEffect(() => {
    setUrl(null)
    setPreviewUrl(null)
    setLoadError(null)
    setProgress(null)
    setDownloadingId(0)
    if (!fileId || !item) return

    let alive = true

    const thumbFileId = item.thumbFileId ?? 0
    if (thumbFileId > 0 && thumbFileId !== fileId) {
      void ensureMedia(thumbFileId, MEDIA_PRIORITY.thumbVisible, owners.preview)
        .then((next) => {
          if (alive) setPreviewUrl(next)
        })
        .catch(() => undefined)
    }

    if (video) {
      setDownloadingId(fileId)
      void streamMedia(fileId, owners.primary)
        .then((next) => {
          if (alive) setUrl(next)
        })
        .catch((error: unknown) => {
          if (alive) setLoadError(errorMessage(error))
        })
    } else {
      // The window is the biggest box the picture is ever drawn in; asking for
      // the variant that covers it is what the full-size download is for.
      const ratio = window.devicePixelRatio || 1
      const chosen = pickVariant(item.sizes, {
        width: window.innerWidth * ratio,
        height: window.innerHeight * ratio,
      })
      setDownloadingId(chosen?.fileId ?? fileId)
      void ensureMedia(chosen?.fileId ?? fileId, MEDIA_PRIORITY.viewer, owners.primary)
        .then((next) => {
          if (alive) setUrl(next)
        })
        .catch((error: unknown) => {
          if (alive) setLoadError(errorMessage(error))
        })
    }

    return () => {
      alive = false
      releaseMedia(owners.preview)
      releaseMedia(owners.primary)
    }
  }, [fileId, video, item, owners])

  useEffect(() => {
    if (!downloadingId) return
    return window.tg.on('evt:file', ({ payload }) => {
      if (payload.fileId !== downloadingId) return
      if (payload.completed || payload.total <= 0) setProgress(null)
      else setProgress(Math.min(1, Math.max(0, payload.downloaded / payload.total)))
    })
  }, [downloadingId])

  return { url, previewUrl, loadError, progress }
}
