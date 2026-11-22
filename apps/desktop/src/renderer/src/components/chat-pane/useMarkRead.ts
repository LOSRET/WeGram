import { useEffect } from 'react'

import { invoke } from '../../lib/ipc'
import { mayMarkRead } from '../../lib/readGate'

/**
 * How long the newest message may sit in an open, focused window before it is
 * reported as read. Long enough to coalesce a burst of arriving messages into one
 * call, short enough that the badge clears while the reader is still there.
 */
const MARK_READ_DELAY_MS = 350

/**
 * 已读上报, split out of `chat-pane/index.tsx` when that file reached its
 * 550-line budget.
 *
 * Reading happens while the chat is open, and it happens *message by message*:
 * the report moves to whatever the reader has actually had on screen, so the
 * server's unread count — and with it the chat row and the rail badge — falls as
 * they scroll through the new messages instead of only when they hit the bottom.
 *
 * `messages:read` is idempotent and TDLib's marker is monotonic, so the unread
 * snapshot taken when the chat opened, a burst of scroll positions and this effect
 * may all overlap. The delay coalesces a burst of arrivals into one call.
 *
 * The gate is `mayMarkRead` (`lib/readGate.ts`): a message that never appeared on
 * screen must not be reported as read, however far the marker could move.
 */
export function useMarkRead(chatId: number | null, seenUpToMessageId: number | null): void {
  useEffect(() => {
    if (chatId === null || seenUpToMessageId === null) return
    const markRead = (): void => {
      const allowed = mayMarkRead({
        seenUpToMessageId,
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
      })
      if (!allowed) return
      void invoke('messages:read', { chatId, upToMessageId: seenUpToMessageId }).catch(
        () => undefined,
      )
    }
    const timer = window.setTimeout(markRead, MARK_READ_DELAY_MS)
    // Reopening the window (or the pane) re-checks: the reader may have been
    // looking at these messages all along while the app was behind another window.
    window.addEventListener('focus', markRead)
    document.addEventListener('visibilitychange', markRead)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', markRead)
      document.removeEventListener('visibilitychange', markRead)
    }
  }, [chatId, seenUpToMessageId])
}
