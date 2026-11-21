import type { StickerSet } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'

/**
 * The stickers of the open tab, fetched on demand and cached for the life of the
 * panel: opening the picker must never download every sticker in the account.
 */
export function useActiveStickerSet(activeSetId: string | null): {
  activeSet: StickerSet | null
  setLoading: boolean
  setError: string | null
} {
  const [activeSet, setActiveSet] = useState<StickerSet | null>(null)
  const [setLoading, setSetLoading] = useState(false)
  const [setError, setSetError] = useState<string | null>(null)
  const setCache = useRef(new Map<string, StickerSet>())

  useEffect(() => {
    if (!activeSetId) return
    const cached = setCache.current.get(activeSetId)
    if (cached) {
      setActiveSet(cached)
      setSetLoading(false)
      setSetError(null)
      return
    }
    let cancelled = false
    setSetLoading(true)
    setSetError(null)
    setActiveSet(null)
    void (async () => {
      try {
        const set = await invoke('stickers:set', { setId: activeSetId })
        if (cancelled) return
        setCache.current.set(set.id, set)
        setActiveSet(set)
      } catch (cause) {
        if (!cancelled) setSetError(errorMessage(cause))
      } finally {
        if (!cancelled) setSetLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeSetId])

  return { activeSet, setLoading, setError }
}
