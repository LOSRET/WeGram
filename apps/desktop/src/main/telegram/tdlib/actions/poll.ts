import { AppError } from '@wegram/protocol'
import type { InvokeRequest } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapMessage } from '../map/message'
import type { ActionDeps } from './deps'
import { formattedText } from './message-input'

/**
 * Changes this account's answer to a poll (design doc §9.10).
 *
 * TDLib addresses the poll through its message, and option_ids are positions in
 * poll.options — not the option id strings that newer polls also carry. An empty
 * list retracts the answer.
 *
 * A vote is not echoed by the command: setPollAnswer answers Ok and the changed
 * poll arrives later as updateMessageContent. That update re-reads the message
 * and swallowed a failure there, so a vote that had landed could leave the card
 * on its old counts — the reader sees "nothing happened" and clicks again. The
 * message is therefore read back here, with the answer to the call that caused
 * it; the later update is a no-op replace.
 */
export async function votePoll(
  deps: ActionDeps,
  input: InvokeRequest<'messages:vote'>,
): Promise<void> {
  try {
    await answer(deps, {
      _: 'setPollAnswer',
      chat_id: input.chatId,
      message_id: input.messageId,
      option_ids: input.optionIds,
    })
  } catch (error) {
    // A refusal means this copy is stale (voted elsewhere, quiz settled): re-read
    // it before reporting, so the card cannot stay votable after the server said no.
    await refreshPoll(deps, input.chatId, input.messageId)
    if (isRevoteRefusal(error)) throw new AppError('poll_answered', '这道题已经答过了')
    throw error
  }
  await refreshPoll(deps, input.chatId, input.messageId)
}

/** Adds an answer option when the poll allows it (messagePoll.can_add_option). */
export async function addPollOption(
  deps: ActionDeps,
  input: InvokeRequest<'messages:addPollOption'>,
): Promise<void> {
  await answer(deps, {
    _: 'addPollOption',
    chat_id: input.chatId,
    message_id: input.messageId,
    // `media` is a nullable class field: TDLib's JSON parser wants it present.
    option: { _: 'inputPollOption', text: formattedText(input.text), media: null },
  })
  await refreshPoll(deps, input.chatId, input.messageId)
}

/**
 * One poll write, with a refusal left in the log.
 *
 * The renderer does show the AppError in its error bar, but that bar is easy to
 * miss and carries only the mapped message. A vote the server refuses is a
 * TDLib-level fact, and `.cache/app.log` is where the next session looks for it.
 */
async function answer(deps: ActionDeps, method: TdObject): Promise<void> {
  try {
    await deps.invoke(method)
  } catch (error) {
    deps.logger.warn(`poll: ${String(method._)} was refused`, error)
    throw error
  }
}

/** TDLib's refusal for an answer this account already gave: a quiz is final. */
function isRevoteRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /can't revote/i.test(message)
}

/** Replaces the row with the server's copy, so the card never waits for an update. */
async function refreshPoll(deps: ActionDeps, chatId: number, messageId: number): Promise<void> {
  try {
    const raw = await deps.invoke({ _: 'getMessage', chat_id: chatId, message_id: messageId })
    if (!raw || raw._ === 'error') return
    const message = await mapMessage(deps.mapper, chatId, raw)
    deps.emit({ type: 'messages', chatId, ops: [{ op: 'replace', message }] })
  } catch (error) {
    // The update that normally carries the new poll can still arrive.
    deps.logger.warn('poll: could not read the message back after a write', error)
  }
}
