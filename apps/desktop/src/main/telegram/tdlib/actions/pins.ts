import type { ChatPinnedMessage } from '@wegram/protocol'

import type { TdObject } from '../client'
import { previewContent } from '../map/content'
import type { ActionDeps } from './deps'

/**
 * 置顶消息: the chat's pinned message as 群公告 reads it, plus pin / unpin.
 *
 * Split out of `chats.ts` when the pin batch pushed that file over its size
 * budget. Telegram keeps one newest pinned message per chat; a group uses it as the
 * announcement, and the bar above the transcript shows it for every chat kind.
 */

/** The newest pinned message, or null when nothing is pinned (TDLib answers 404). */
export async function pinnedMessage(
  deps: ActionDeps,
  chatId: number,
): Promise<ChatPinnedMessage | null> {
  let message: TdObject | undefined
  try {
    message = await deps.invoke({ _: 'getChatPinnedMessage', chat_id: chatId })
  } catch {
    return null
  }
  if (!message?.id) return null
  return { messageId: Number(message.id), text: previewContent(message.content) }
}

/**
 * 置顶消息 / 取消置顶.
 *
 * TDLib pins one message per chat and `unpinChatMessage` wants that message's id,
 * so an unpin resolves the current pin first — the bar's × then does not have to
 * carry the id around. Notification-free on purpose: pinning is a quiet action,
 * and the reader is the one doing it.
 */
export async function setPinnedMessage(
  deps: ActionDeps,
  chatId: number,
  messageId: number | null,
): Promise<ChatPinnedMessage | null> {
  if (messageId === null) {
    const current = await pinnedMessage(deps, chatId)
    if (!current) return null
    await deps.invoke({
      _: 'unpinChatMessage',
      chat_id: chatId,
      message_id: current.messageId,
    })
    return null
  }
  await deps.invoke({
    _: 'pinChatMessage',
    chat_id: chatId,
    message_id: messageId,
    disable_notification: true,
    only_for_self: false,
  })
  return pinnedMessage(deps, chatId)
}
