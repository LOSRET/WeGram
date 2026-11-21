import type { InvokeRequest } from '@wegram/protocol'

import type { ActionDeps } from './deps'
import { formattedText } from './message-input'

/**
 * Changes this account's answer to a poll (design doc §9.10).
 *
 * TDLib addresses the poll through its message, and option_ids are positions in
 * poll.options — not the option ids strings that newer polls also carry. An empty
 * list retracts the answer.
 */
export async function votePoll(
  deps: ActionDeps,
  input: InvokeRequest<'messages:vote'>,
): Promise<void> {
  await deps.invoke({
    _: 'setPollAnswer',
    chat_id: input.chatId,
    message_id: input.messageId,
    option_ids: input.optionIds,
  })
}

/** Adds an answer option when the poll allows it (messagePoll.can_add_option). */
export async function addPollOption(
  deps: ActionDeps,
  input: InvokeRequest<'messages:addPollOption'>,
): Promise<void> {
  await deps.invoke({
    _: 'addPollOption',
    chat_id: input.chatId,
    message_id: input.messageId,
    // `media` is a nullable class field: TDLib's JSON parser wants it present.
    option: { _: 'inputPollOption', text: formattedText(input.text), media: null },
  })
}
