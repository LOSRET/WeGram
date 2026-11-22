import type { ChatSummary } from '@wegram/protocol'

import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'
import type { MenuItem } from '../ContextMenu'

/**
 * The conversation row's right-click menu.
 *
 * WeChat reaches all four of these from the same list menu, and three of them had
 * no entry point at all before (only 清空 lived in 聊天信息). The rows are built
 * from the live summary, so a menu opened on a pinned chat says 取消置顶.
 *
 * Delete is the one row that changes the list itself: the adapter sends
 * `deleteChatHistory` with `remove_from_chat_list: true` and the `remove` op
 * drops the row and its transcript (see `store/slices/chats.ts`).
 */

export type ChatMenuAction = 'pin' | 'mute' | 'unread' | 'delete'

export function buildChatMenuItems(
  chat: ChatSummary,
  run: (action: ChatMenuAction) => void,
): MenuItem[] {
  return [
    {
      label: chat.pinned ? '取消置顶' : '置顶聊天',
      onSelect: () => run('pin'),
    },
    {
      label: chat.muted ? '取消消息免打扰' : '消息免打扰',
      onSelect: () => run('mute'),
    },
    {
      label: chat.markedUnread ? '标为已读' : '标为未读',
      onSelect: () => run('unread'),
    },
    {
      label: '删除聊天',
      danger: true,
      onSelect: () => run('delete'),
    },
  ]
}

/** Applies one menu action and keeps the row in sync with the adapter's answer. */
export async function runChatMenuAction(
  chat: ChatSummary,
  action: ChatMenuAction,
): Promise<void> {
  const store = useAppStore.getState()
  try {
    switch (action) {
      case 'pin': {
        const updated = await invoke('chats:setPinned', { chatId: chat.id, pinned: !chat.pinned })
        store.applyChatOps([{ op: 'upsert', chat: updated }])
        return
      }
      case 'mute': {
        const updated = await invoke('chats:setMuted', { chatId: chat.id, muted: !chat.muted })
        store.applyChatOps([{ op: 'upsert', chat: updated }])
        return
      }
      case 'unread': {
        const updated = await invoke('chats:setUnread', {
          chatId: chat.id,
          unread: !chat.markedUnread,
        })
        store.applyChatOps([{ op: 'upsert', chat: updated }])
        return
      }
      case 'delete': {
        await invoke('chats:delete', { chatId: chat.id })
        store.applyChatOps([{ op: 'remove', chatId: chat.id }])
        store.setToast('已删除聊天')
      }
    }
  } catch (error) {
    store.setError(errorMessage(error))
  }
}
