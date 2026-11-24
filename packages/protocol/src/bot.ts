import { z } from 'zod'

import { inlineButtonCallbackSchema, messageSchema } from './dto'

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

/**
 * One inline query result (`inlineQueryResult*`), as the picker draws it.
 *
 * The result itself belongs to the bot and is identified by an opaque id; the
 * client never builds it. `kind` is the row's word (图片 / 动图 / 文章 …) and the
 * thumbnail is the file the row paints first, when the bot sent one.
 */
export const inlineResultSchema = z.object({
  /** TDLib `InlineQueryResult.id`; posted back verbatim when the row is sent. */
  id: z.string().min(1),
  /** What kind of row this is, in the client's own words. */
  kind: z.string().min(1),
  title: z.string(),
  description: z.string().optional(),
  /** TDLib `thumbnail.file.id` (photo results use their largest size). */
  thumbFileId: z.number().int().positive().optional(),
})
export type InlineResult = z.infer<typeof inlineResultSchema>

/**
 * What one inline query answered: the results, the query they belong to, and the
 * cursor for the next chunk (TDLib's `next_offset`, empty when there is none).
 */
export const inlineQueryAnswerSchema = z.object({
  /** TDLib `inline_query_id`: the int64 travels as a string, it is an id not a count. */
  queryId: z.string().min(1),
  /** Empty means "no more results"; otherwise the cursor to ask again with. */
  nextOffset: z.string(),
  results: z.array(inlineResultSchema),
})
export type InlineQueryAnswer = z.infer<typeof inlineQueryAnswerSchema>

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
  /**
   * inline 机器人 (`@bot 查询`, design doc §8.3): the results one @username answers.
   * The bot is named by username because an inline query is the only place a bot
   * this account has never talked to is reached; main resolves it, checks it is
   * one, and asks TDLib `getInlineQueryResults`.
   */
  'bots:inlineQuery',
  /**
   * Sends one inline result into the chat (TDLib `sendInlineQueryResultMessage`).
   * The bot builds the message, so the answer is the row TDLib created — the
   * renderer only appends it and lets the send succeeded update re-key it.
   */
  'bots:inlineSend',
] as const

export const botInvokeSchemas = {
  'bots:commands': {
    request: z.object({ chatId: z.number().int() }),
    response: botCommandsAnswerSchema,
  },
  'bots:inlineQuery': {
    request: z.object({
      /** The chat the query is being typed in: a bot may answer differently per chat. */
      chatId: z.number().int(),
      /** The bot's @username without the '@' (Telegram usernames are 5+ chars). */
      username: z.string().trim().min(3).max(64),
      /** What follows the username; an empty query asks for the bot's defaults. */
      query: z.string().max(512),
      /** The previous answer's `nextOffset`; omitted for the first chunk. */
      offset: z.string().optional(),
    }),
    response: inlineQueryAnswerSchema,
  },
  'bots:inlineSend': {
    request: z.object({
      chatId: z.number().int(),
      topicId: z.number().int().positive().optional(),
      /** The `queryId` of the answer the result came from. */
      queryId: z.string().min(1),
      resultId: z.string().min(1),
    }),
    response: z.object({ localId: z.string(), message: messageSchema }),
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
