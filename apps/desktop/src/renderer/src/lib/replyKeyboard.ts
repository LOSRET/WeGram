import type { Message, ReplyKeyboard } from '@wegram/protocol'

/** The keyboard a chat shows, and the message that put it there. */
export interface ActiveReplyKeyboard {
  /** The carrying message's id: what a one-time hide is keyed by. */
  messageId: number
  /** The sender's user id: the bot a Web App key belongs to (§9.4). */
  senderId: number
  keyboard: ReplyKeyboard
}

/**
 * The bot keyboard a chat shows right now (§8.3).
 *
 * Telegram keeps the keyboard of the most recent message that has one: a plain
 * reply after it does not clear the grid, and only a newer keyboard, the
 * keyboard's own `oneTime`, or the bot taking it away
 * (`replyMarkupRemoveKeyboard` → `replyKeyboardHidden`) does. The store keeps a
 * transcript oldest-first, so this walks from the end and stops at the first row
 * that has an opinion.
 */
export function activeReplyKeyboard(messages: readonly Message[]): ActiveReplyKeyboard | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    // The removal row carries no keyboard at all, so the marker itself is the
    // newest word on the subject — an older grid must not come back.
    if (message.replyKeyboardHidden) return null
    const keyboard = message.replyKeyboard
    if (!keyboard || keyboard.rows.length === 0) continue
    return { messageId: message.id, senderId: message.senderId, keyboard }
  }
  return null
}
