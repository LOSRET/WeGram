import { useCallback, useEffect, useRef, useState } from 'react'

import { RECENT_EMOJI_LIMIT, mergeRecentEmoji } from '../../lib/emoji'
import { invoke } from '../../lib/ipc'

/**
 * The 最近使用 row. It lives in `ui.db`, so it survives a restart like the
 * client's. The ref is the write path: `remember` must not depend on a state
 * update having landed before the next pick.
 */
export function useRecentEmoji(): {
  recent: string[]
  remember: (char: string) => void
} {
  const [recent, setRecent] = useState<string[]>([])
  const recentRef = useRef<string[]>([])

  useEffect(() => {
    let cancelled = false
    void invoke('ui:getRecentEmoji')
      .then((list) => {
        if (cancelled) return
        const valid = list.filter((item) => item.length > 0).slice(0, RECENT_EMOJI_LIMIT)
        recentRef.current = valid
        setRecent(valid)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const remember = useCallback((char: string) => {
    const next = mergeRecentEmoji(recentRef.current, char)
    recentRef.current = next
    setRecent(next)
    void invoke('ui:saveRecentEmoji', { emoji: next }).catch(() => undefined)
  }, [])

  return { recent, remember }
}
