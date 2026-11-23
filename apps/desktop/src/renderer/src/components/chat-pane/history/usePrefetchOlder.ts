import { useCallback, useRef } from 'react'

import { HISTORY_PAGE_SIZE } from '../../../lib/history'
import { invoke } from '../../../lib/ipc'
import { useAppStore } from '../../../store/useAppStore'

/**
 * Fetch the page below the oldest loaded row *before* the reader asks for it.
 *
 * This is the one wait the transcript cannot otherwise hide: TDLib answers an
 * older page from its local cache or from the server, and the first server
 * answer was measured at ~3.4 s (`docs/HANDOFF.md`). A wheel gesture covers the
 * last screen in about a second, so a fetch started at the top always shows up
 * as a dead scroll — the "卡手" the reader reports. Keeping one page in hand
 * (`olderPagesByChat`) means `loadOlder` usually only has to prepend it.
 *
 * Failures and empty answers stay silent: this is speculative work, and the
 * real load reports its own error when the reader gets there.
 */
export function usePrefetchOlder(
  activeChatId: number | null,
  /** 话题 (design doc §9.12); `null` is a flat transcript. */
  activeTopicId: number | null,
): () => void {
  /** The chat whose prefetch is in flight: one speculative request at a time. */
  const prefetchingChatRef = useRef<number | null>(null)

  return useCallback((): void => {
    const chatId = activeChatId
    if (chatId === null || prefetchingChatRef.current === chatId) return
    const store = useAppStore.getState()
    if (store.hasMoreByChat[chatId] !== true) return
    const oldest = (store.messagesByChat[chatId] ?? [])[0]
    if (!oldest) return
    const buffered = store.olderPagesByChat[chatId]
    // Warm already. (A page buffered below a row that is gone is not "warm":
    // the store refuses it on insert, so ask again here.)
    if (buffered !== undefined && buffered.afterId === oldest.id) return

    prefetchingChatRef.current = chatId
    void invoke('messages:history', {
      chatId,
      ...(activeTopicId === null ? {} : { topicId: activeTopicId }),
      fromMessageId: oldest.id,
      limit: HISTORY_PAGE_SIZE,
    })
      .then((older) => {
        // Never buffer an empty page: a cold TDLib cache answers `[]`, and
        // inserting that would also report the wrong `hasMore`.
        if (older.messages.length === 0) return
        useAppStore.getState().bufferOlderPage(chatId, oldest.id, older.messages, older.hasMore)
      })
      .catch(() => undefined)
      .finally(() => {
        if (prefetchingChatRef.current === chatId) prefetchingChatRef.current = null
      })
  }, [activeChatId, activeTopicId])
}
