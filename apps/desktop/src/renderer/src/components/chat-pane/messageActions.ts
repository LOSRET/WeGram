import type { Message } from '@wegram/protocol'

import { loadLatestWindow } from '../../lib/anchoredWindow'
import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'

export interface MessageActions {
  send: (text: string, replyToMessageId: number | undefined) => Promise<void>
  saveEdit: (messageId: number, text: string) => Promise<void>
  removeMessage: (message: Message, forBoth: boolean) => Promise<void>
  forward: (message: Message, toChatId: number) => Promise<void>
  copy: (message: Message) => void
}

/** The confirm dialog's payload: which message, and whether 撤回 or 删除. */
export interface PendingDelete {
  message: Message
  forBoth: boolean
}

/**
 * The transcript's write operations for one chat.
 *
 * A plain factory, not a hook: it holds no state and is only built when a chat is
 * active, which keeps every call site free of null checks. Each operation updates
 * the store optimistically-enough by applying the op it just performed, so the UI
 * does not wait for the server echo (`applyMessageOps` also handles the echo).
 */
export function createMessageActions(activeChatId: number): MessageActions {
  return {
    send: async (text, replyToMessageId) => {
      /**
       * An anchored window cannot show the new message in place (it would sit
       * directly under a row months older). Return to the newest page first, then
       * send; the jump is requested after the message is in the store so the
       * scroll lands on it rather than on the previous tail.
       */
      const wasAnchored = await loadLatestWindow(activeChatId)
      const result = await invoke('messages:send', {
        chatId: activeChatId,
        text,
        ...(replyToMessageId === undefined ? {} : { replyTo: replyToMessageId }),
      })
      const store = useAppStore.getState()
      store.applyMessageOps(activeChatId, [{ op: 'new', message: result.message }])
      store.setReplyTo(activeChatId, null)
      if (wasAnchored) store.requestJumpToLatest(activeChatId)
    },

    saveEdit: async (messageId, text) => {
      const updated = await invoke('messages:edit', { chatId: activeChatId, messageId, text })
      const store = useAppStore.getState()
      store.applyMessageOps(activeChatId, [
        { op: 'edit', chatId: activeChatId, messageId, text: updated.text },
      ])
      store.setEditing(null)
    },

    removeMessage: async (message, forBoth) => {
      try {
        await invoke('messages:delete', {
          chatId: message.chatId,
          messageIds: [message.id],
          forBoth,
        })
        useAppStore
          .getState()
          .applyMessageOps(message.chatId, [
            { op: 'delete', chatId: message.chatId, messageIds: [message.id] },
          ])
        useAppStore.getState().setToast('已删除')
      } catch (error) {
        useAppStore.getState().setError(errorMessage(error))
      }
    },

    forward: async (message, toChatId) => {
      try {
        await invoke('messages:forward', {
          fromChatId: message.chatId,
          messageIds: [message.id],
          toChatId,
        })
        useAppStore.getState().setToast('已转发')
      } catch (error) {
        useAppStore.getState().setError(errorMessage(error))
      }
    },

    copy: (message) => {
      void navigator.clipboard
        .writeText(message.text)
        .then(() => useAppStore.getState().setToast('已复制'))
        .catch(() => useAppStore.getState().setToast('复制失败'))
    },
  }
}
