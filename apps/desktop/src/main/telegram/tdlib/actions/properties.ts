import type { MessageProperties } from '@wegram/protocol'

import type { TdObject } from '../client'
import type { ActionDeps } from './deps'

/**
 * TDLib's per-message capabilities for the context menu.
 *
 * `getMessageProperties` is an offline call: the edit window, protected content
 * and the delete-for-me / delete-for-everyone split are TDLib's rules, not ours.
 * The renderer asks once when a menu opens, so a transcript row does not pay for
 * it on every page.
 */
export async function messageProperties(
  deps: Pick<ActionDeps, 'invoke'>,
  input: { chatId: number; messageId: number },
): Promise<MessageProperties> {
  const raw: TdObject = await deps.invoke({
    _: 'getMessageProperties',
    chat_id: input.chatId,
    message_id: input.messageId,
  })
  return {
    canBeEdited: Boolean(raw?.can_be_edited),
    canBeForwarded: Boolean(raw?.can_be_forwarded),
    canBeDeletedOnlyForSelf: Boolean(raw?.can_be_deleted_only_for_self),
    canBeDeletedForAllUsers: Boolean(raw?.can_be_deleted_for_all_users),
    canBeCopied: Boolean(raw?.can_be_copied),
    canBeReplied: Boolean(raw?.can_be_replied),
    canRecognizeSpeech: Boolean(raw?.can_recognize_speech),
  }
}
