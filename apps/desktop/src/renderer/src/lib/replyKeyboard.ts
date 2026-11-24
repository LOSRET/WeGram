import type { Message, ReplyKeyboard } from '@wegram/protocol'

/** The keyboard a chat shows, and the message that put it there. */
export interface ActiveReplyKeyboard {
  /** The carrying message's id: what a one-time hide is keyed by. */
  messageId: number
  keyboard: ReplyKeyboard
}

/**
 * The bot keyboard a chat shows right now (§8.3).
 *
 * Telegram keeps the keyboard of the most recent message that has one: a plain
 * reply after it does not clear the grid, and only a newer keyboard (or the
 * keyboard's own `oneTime`) takes it away. The store keeps a transcript
 * oldest-first, so this walks from the end and stops at the first markup.
 */
export function activeReplyKeyboard(messages: readonly Message[]): ActiveReplyKeyboard | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    const keyboard = message.replyKeyboard
    if (!keyboard || keyboard.rows.length === 0) continue
    return { messageId: message.id, keyboard }
  }
  return null
}
