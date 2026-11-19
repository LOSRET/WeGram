import type { ViewerItem } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'

/**
 * Downloads the current item at the viewer's priority and follows its progress.
 *
 * The download is re-issued per file: the viewer pages through the strip, and a
 * stale answer must never replace the picture the reader is looking at.
 */
export function useViewerItem(item: ViewerItem | undefined): {
  url: string | null
  loadError: string | null
  progress: number | null
} {
  const fileId = item?.fileId ?? 0
  const [url, setUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  useEffect(() => {
    setUrl(null)
    setLoadError(null)
    setProgress(null)
    if (!fileId) return

    let alive = true
    invoke('media:download', { fileId, priority: 10 })
      .then(({ url: downloaded }) => {
        if (alive) setUrl(downloaded)
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(errorMessage(error))
      })
    return () => {
      alive = false
    }
  }, [fileId])

  useEffect(() => {
    if (!fileId) return
    return window.tg.on('evt:file', ({ payload }) => {
      if (payload.fileId !== fileId) return
      if (payload.completed || payload.total <= 0) setProgress(null)
      else setProgress(Math.min(1, Math.max(0, payload.downloaded / payload.total)))
    })
  }, [fileId])

  return { url, loadError, progress }
}
