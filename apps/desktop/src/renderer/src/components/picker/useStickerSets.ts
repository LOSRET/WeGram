import type { StickerSetSummary } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'

/**
 * Installed sets feed the tab strip; the emoji tab works without them.
 *
 * The first answer can be TDLib's pre-sync local cache (a dozen sets instead
 * of the account's full list), so this also refetches when
 * `updateInstalledStickerSets` lands — see `evt:stickerSets`.
 */
export function useStickerSets(): {
  sets: StickerSetSummary[]
  setsLoaded: boolean
  setsError: string | null
} {
  const stickerSetsVersion = useAppStore((state) => state.stickerSetsVersion)
  const [sets, setSets] = useState<StickerSetSummary[]>([])
  const [setsLoaded, setSetsLoaded] = useState(false)
  const [setsError, setSetsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await invoke('stickers:sets')
        if (!cancelled) {
          setSets(result)
          setSetsError(null)
        }
      } catch (cause) {
        if (!cancelled) setSetsError(errorMessage(cause))
      } finally {
        if (!cancelled) setSetsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [stickerSetsVersion])

  return { sets, setsLoaded, setsError }
}
