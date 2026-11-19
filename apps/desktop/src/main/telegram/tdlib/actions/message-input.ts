import type { Message } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapMessage } from '../map/message'
import type { ActionDeps } from './deps'

/**
 * The request fragments every outgoing message shares.
 *
 * `clear_draft` is only set for a message the reader sends: an edit must leave
 * the composer's draft alone, and TDLib reads an absent flag as "do not clear".
 */
export function formattedText(text: string | undefined): TdObject {
  return { _: 'formattedText', text: text ?? '', entities: [] }
}

export function replyTo(messageId?: number): TdObject | null {
  return messageId === undefined ? null : { _: 'inputMessageReplyToMessage', message_id: messageId }
}

export function inputText(text: string | undefined, clearDraft = false): TdObject {
  return {
    _: 'inputMessageText',
    text: formattedText(text),
    ...(clearDraft ? { clear_draft: true } : {}),
  }
}

/**
 * Sends one message content and maps the answer.
 *
 * The local id is what the renderer tracks until the server id replaces it, so
 * it is minted here rather than in each action.
 */
export async function sendAndMap(
  deps: Pick<ActionDeps, 'invoke' | 'mapper'>,
  chatId: number,
  content: TdObject,
  /** `options: null` is the TDLib field media sends carry; text sends omit it. */
  init: { replyTo?: number; options?: TdObject | null } = {},
): Promise<{ localId: string; message: Message }> {
  const response = await deps.invoke({
    _: 'sendMessage',
    chat_id: chatId,
    reply_to: replyTo(init.replyTo),
    ...(init.options === undefined ? {} : { options: init.options }),
    input_message_content: content,
  })
  const message = await mapMessage(deps.mapper, chatId, response)
  return { localId: `td-${message.id}`, message }
}
