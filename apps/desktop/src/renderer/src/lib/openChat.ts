import type { ChatSummary } from '@wegram/protocol'

import { useAppStore } from '../store/useAppStore'
import { errorMessage, invoke } from './ipc'

/**
 * Opens one conversation in the shell.
 *
 * The unread snapshot has to be taken *before* the reader's own `messages:read`
 * can move the marker, or the unread divider would vanish before the list mounts.
 * Shared by the chat row (which closes the pane when the row is already open; see
 * `MainShell`) and by 定位到聊天位置, which must never toggle the conversation shut.
 */
export function activateChat(chat: ChatSummary): void {
  const store = useAppStore.getState()
  store.setUnreadMarker(
    chat.id,
    chat.unread > 0
      ? { lastReadInboxMessageId: chat.lastReadInboxMessageId ?? null, unread: chat.unread }
      : null,
  )
  store.setActiveChat(chat.id)
  // History is loaded by ChatPane; this only triggers read state.
  void invoke('chats:open', { chatId: chat.id }).catch((cause) => {
    useAppStore.getState().setError(errorMessage(cause))
  })
}
