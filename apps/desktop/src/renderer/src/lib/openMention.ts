import { useAppStore } from '../store/useAppStore'

import { errorMessage, invoke } from './ipc'
import { isSelfMention, type MentionTarget } from './mention'
import { activateChat } from './openChat'

/**
 * Opens the conversation behind an @mention (design doc §8.3).
 *
 * Two entity kinds lead here: `mentionName` carries the user id (`chats:openPrivate`
 * creates the private chat when this account never wrote to that person), and
 * `mention` is a username that main resolves with TDLib's `searchPublicChat`. The
 * answered row is upserted before the chat activates, exactly like the contact
 * card's 发消息, so a person with no conversation yet does not flash a placeholder.
 *
 * A name nobody owns is an expected answer, not a failure of the pane: it becomes
 * a toast carrying main's Chinese sentence, and the transcript stays where it is.
 */
export function openMention(target: MentionTarget): void {
  const store = useAppStore.getState()
  if (store.auth.kind === 'ready' && isSelfMention(target, store.auth.me)) {
    store.setToast('这是你自己的账号')
    return
  }
  void (async () => {
    try {
      const chat =
        target.kind === 'user'
          ? await invoke('chats:openPrivate', { userId: target.userId })
          : await invoke('chats:openUsername', { username: target.username })
      useAppStore.getState().applyChatOps([{ op: 'upsert', chat }])
      activateChat(chat)
    } catch (cause) {
      useAppStore.getState().setToast(errorMessage(cause))
    }
  })()
}
