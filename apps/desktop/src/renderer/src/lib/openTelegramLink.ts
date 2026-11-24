import type { ChatSummary } from '@wegram/protocol'

import { useAppStore } from '../store/useAppStore'

import { errorMessage, invoke } from './ipc'
import { activateChat } from './openChat'
import type { TelegramLinkTarget } from './telegramLink'

/**
 * Opens a Telegram link inside the shell (design doc §8.3).
 *
 * `https://t.me/…` and `tg://…` name a chat, and often one post in it; the
 * official clients stay inside the app for those, which is what makes a linked
 * message in a channel a jump. The chat is resolved by the adapter
 * (`searchPublicChat`, `createPrivateChat` or a plain `getChat` for private
 * channel links), upserted so the row exists before the pane mounts, and the
 * locate is requested *before* activation — the first page is then fetched around
 * the target row instead of landing on the newest message.
 *
 * A link whose chat cannot be opened (deleted channel, wrong account, no
 * permission) crosses IPC as an `AppError` and becomes a toast; the transcript
 * stays where it is.
 */
export function openTelegramLink(target: TelegramLinkTarget): void {
  void (async () => {
    try {
      const chat = await resolveChat(target)
      const store = useAppStore.getState()
      store.applyChatOps([{ op: 'upsert', chat }])
      if (target.kind === 'username') {
        if (target.startParameter === undefined) store.clearBotStartParameter(chat.id)
        else store.setBotStartParameter(chat.id, target.startParameter)
      }
      const messageId = target.kind === 'user' ? undefined : target.messageId
      // A private chat has no public post links; TDLib would answer no page.
      if (messageId !== undefined && chat.kind !== 'private') {
        store.requestLocate(chat.id, messageId)
      }
      activateChat(chat)
    } catch (cause) {
      // Username and user links already fail with a Chinese sentence from main;
      // `t.me/c` links reach TDLib's own "chat not found" instead.
      useAppStore
        .getState()
        .setToast(target.kind === 'chat' ? '这个链接指向的会话打不开' : errorMessage(cause))
    }
  })()
}

function resolveChat(target: TelegramLinkTarget): Promise<ChatSummary> {
  if (target.kind === 'user') return invoke('chats:openPrivate', { userId: target.userId })
  if (target.kind === 'chat') return invoke('chats:get', { chatId: target.chatId })
  return invoke('chats:openUsername', { username: target.username })
}
