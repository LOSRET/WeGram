import type { ChatPinnedMessage } from '@wegram/protocol'
import { useCallback, useEffect, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'

/**
 * 置顶消息 state for the open chat: what it has pinned, and the pin / unpin calls.
 *
 * TDLib keeps one pinned message per chat; the pane asks once per chat and keeps
 * the answer, because both the bar above the transcript and the context menu read
 * it. "Nothing pinned" is an empty answer rather than an error — WeChat has no such
 * bar at all, so nothing may surface when there is simply no pin.
 *
 * `setPinnedMessage(null)` unpins whatever is pinned (the adapter resolves the id).
 */
export function usePinnedMessage(chatId: number | null): {
  pinned: ChatPinnedMessage | null
  setPinnedMessage: (messageId: number | null) => Promise<void>
} {
  const [pinned, setPinned] = useState<ChatPinnedMessage | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPinned(null)
    if (chatId === null) return
    let cancelled = false
    void invoke('chats:pinned', { chatId })
      .then((answer) => {
        if (!cancelled) setPinned(answer)
      })
      .catch(() => {
        // A failed lookup leaves the bar away; the next open asks again.
      })
    return () => {
      cancelled = true
    }
  }, [chatId])

  const setPinnedMessage = useCallback(
    async (messageId: number | null): Promise<void> => {
      if (chatId === null || busy) return
      setBusy(true)
      try {
        const answer = await invoke('chats:setPinnedMessage', { chatId, messageId })
        setPinned(answer)
        useAppStore.getState().setToast(messageId === null ? '已取消置顶' : '已置顶消息')
      } catch (error) {
        useAppStore.getState().setError(errorMessage(error))
      } finally {
        setBusy(false)
      }
    },
    [chatId, busy],
  )

  return { pinned, setPinnedMessage }
}
