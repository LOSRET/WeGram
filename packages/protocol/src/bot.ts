import { z } from 'zod'

import { inlineButtonCallbackSchema } from './dto'

/**
 * Telegram bots: the two interactions this client makes with one.
 *
 * A bot publishes the commands it understands (`botInfo.commands`), which is what
 * the composer's "/" list draws, and it puts inline keyboards under its messages;
 * a callback button posts data back to the bot (`getCallbackQueryAnswer`), whose
 * answer is a toast, an alert box or a URL to open (design doc §8.3).
 *
 * The domain lives in its own file the way `poll.ts` / `report.ts` do: it is a
 * bot's vocabulary, not a general message one.
 */

/** One command a bot accepts; TDLib stores the text without the leading '/'. */
export const botCommandSchema = z.object({
  /** Command text without the '/', e.g. `start` or `settings`. */
  command: z.string().min(1),
  /** The bot's own description of it; empty when it published none. */
  description: z.string(),
})
export type BotCommand = z.infer<typeof botCommandSchema>

/** What a chat's bot knows, for the composer's "/" list. */
export const botCommandsAnswerSchema = z.object({
  /**
   * True only for a private chat with a bot. A group can contain bots, but
   * Telegram's own command menu there is per-bot and needs a `/cmd@bot` target,
   * so this client keeps the list to one-to-one chats.
   */
  isBot: z.boolean(),
  commands: z.array(botCommandSchema),
})
export type BotCommandsAnswer = z.infer<typeof botCommandsAnswerSchema>

/**
 * A bot's answer to a pressed callback button. TDLib's `callbackQueryAnswer`
 * carries three independent things and any of them may be empty: a text, whether
 * that text is an alert instead of a toast, and a URL the client should open.
 */
export const callbackAnswerSchema = z.object({
  text: z.string().optional(),
  showAlert: z.boolean().optional(),
  url: z.string().optional(),
})
export type CallbackAnswer = z.infer<typeof callbackAnswerSchema>

export const botInvokeChannels = [
  /**
   * The commands the chat's bot publishes, for the composer's "/" list. A chat
   * that is not a bot chat answers `{ isBot: false, commands: [] }`.
   */
  'bots:commands',
  /**
   * Presses one inline keyboard button: TDLib `getCallbackQueryAnswer` with the
   * button's own payload. The answer is displayed by the caller (toast / alert /
   * URL); the message the bot edits arrives as an ordinary content update.
   */
  'bots:callback',
] as const

export const botInvokeSchemas = {
  'bots:commands': {
    request: z.object({ chatId: z.number().int() }),
    response: botCommandsAnswerSchema,
  },
  'bots:callback': {
    request: z.object({
      /** The chat the button's message belongs to. */
      chatId: z.number().int(),
      messageId: z.number().int(),
      /** What the button posts; the mapper read it from TDLib's button type. */
      callback: inlineButtonCallbackSchema,
    }),
    response: callbackAnswerSchema,
  },
}
