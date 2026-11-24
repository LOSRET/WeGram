import type { Message } from '@wegram/protocol'

/** The row a bot is waiting for a direct answer to, and the placeholder it named. */
export interface PendingForceReply {
  /** The message the next send should reply to. */
  messageId: number
  /** TDLib `placeholder`: what the box should say while the answer is owed. */
  placeholder?: string
}

/**
 * 机器人强制回复 (TDLib `replyMarkupForceReply`, §8.3).
 *
 * A bot marks one of its rows as the thing the next message should answer. The
 * official clients select that row as the reply target; this is the pure rule
 * behind that gesture, shared by the pane that draws the banner.
 *
 * Walking the transcript newest-first, the first row that has an opinion is
 * either the marker itself (the answer is still owed) or a message the reader
 * sent (the answer has been sent, so the prompt is done). Anything older cannot
 * matter — a later `forceReply` would have been reached first.
 */
export function activeForceReply(messages: readonly Message[]): PendingForceReply | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    if (message.outgoing) return null
    const forced = message.forceReply
    if (!forced) continue
    return {
      messageId: message.id,
      ...(forced.placeholder ? { placeholder: forced.placeholder } : {}),
    }
  }
  return null
}
