import type { Poll } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { invoke } from './ipc'
import { pollRefreshInterval } from './pollRefresh'

/**
 * Keeps one mounted poll current while its window is visible. TDLib stops pushing
 * content updates after a comment message leaves its cache, so a visible card must
 * touch the row again; see docs/技术方案.md §9.10.
 */
export function usePollRefresh(chatId: number, messageId: number, poll: Poll): boolean {
  const interval = pollRefreshInterval(poll)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (interval === null) {
      setFailed(false)
      return
    }

    let disposed = false
    let inFlight = false
    const refresh = (): void => {
      if (disposed || inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      void invoke('messages:refreshPoll', { chatId, messageId })
        .then(
          (refreshed) => {
            if (!disposed) setFailed(!refreshed)
          },
          () => {
            if (!disposed) setFailed(true)
          },
        )
        .finally(() => {
          inFlight = false
        })
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }

    refresh()
    const timer = window.setInterval(refresh, interval)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [chatId, messageId, interval])

  return failed
}
