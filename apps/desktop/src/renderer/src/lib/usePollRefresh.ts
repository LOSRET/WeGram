import type { Poll } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import type { CommentThreadAnchor } from './commentThread'
import { invoke } from './ipc'
import { pollRefreshInterval } from './pollRefresh'

/**
 * Keeps one mounted poll current while its window is visible.
 *
 * TDLib's own results poll runs every 42–60 seconds and only for a poll whose
 * message it still holds; a comment thread's rows live in the discussion group,
 * which is not the open chat, so TDLib drops them (and the registration) while the
 * thread stays on screen. A poll mounted from a comment thread therefore names that
 * thread in the refresh: main re-reads the row through `getMessageThreadHistory`,
 * which is a server request and repaints the counters it returns. Without a thread
 * the call stays the local `getMessage` keepalive, and the update stream is what
 * moves the card.
 */
export function usePollRefresh(
  chatId: number,
  messageId: number,
  poll: Poll,
  thread: CommentThreadAnchor | null = null,
  /** Off-screen cards pause: a comment panel keeps every loaded row mounted. */
  active = true,
): boolean {
  const interval = pollRefreshInterval(poll)
  const threadChatId = thread?.chatId
  const threadMessageId = thread?.messageId
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (interval === null || !active) {
      setFailed(false)
      return
    }

    let disposed = false
    let inFlight = false
    const refresh = (): void => {
      if (disposed || inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      void invoke('messages:refreshPoll', {
        chatId,
        messageId,
        ...(threadChatId === undefined || threadMessageId === undefined
          ? {}
          : { thread: { chatId: threadChatId, messageId: threadMessageId } }),
      })
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
  }, [chatId, messageId, interval, threadChatId, threadMessageId, active])

  return failed
}
