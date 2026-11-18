import { HISTORY_PAGE_SIZE } from './history'
import { invoke } from './ipc'
import { useAppStore } from '../store/useAppStore'

/**
 * Replaces a window that stops short of the newest message with the newest page.
 *
 * The old rows are gone afterwards, so the reader loses the deep reading position
 * they were on — that is the point: they asked to go to the latest message, or
 * they are about to send one. Callers that want the viewport to follow the new
 * window must ask the list to jump after the reload; `ChatPane` and the send
 * paths do that per chat.
 *
 * Returns false when the window already reaches the newest message (nothing to
 * do), true when a reload happened.
 */
export async function loadLatestWindow(chatId: number): Promise<boolean> {
  if (useAppStore.getState().hasNewerByChat[chatId] !== true) return false
  const page = await invoke('messages:history', { chatId, limit: HISTORY_PAGE_SIZE })
  useAppStore.getState().setHistory(chatId, page.messages, page.hasMore, false)
  return true
}
