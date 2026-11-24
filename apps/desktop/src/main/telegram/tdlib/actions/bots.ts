import { AppError } from '@wegram/protocol'
import type {
  BotCommand,
  BotCommandsAnswer,
  CallbackAnswer,
  InlineButtonCallback,
  InlineQueryAnswer,
  Message,
} from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import { mapInlineResults } from '../map/inline'
import { mapMessage } from '../map/message'
import { replyTo, topicRef } from './message-input'
import type { ActionDeps } from './deps'

/**
 * The bot half of the protocol: the commands a bot publishes and pressing one of
 * its inline buttons.
 *
 * Both are ordinary TDLib requests over local data — the command list lives in
 * `userFullInfo.bot_info`, and a callback button's payload is already in the
 * message — so neither needs a network round trip before it is sent.
 */

/** A chat that is not a private chat with a bot: the composer draws no list. */
const NO_BOT: BotCommandsAnswer = { isBot: false, commands: [] }

/**
 * The commands the chat's bot publishes (`botInfo.commands`).
 *
 * TDLib splits this over three objects: the chat says whether it is private, the
 * user's `type` says whether that person is a bot, and the full info carries the
 * list. A group's commands are deliberately not returned: in a group every bot's
 * commands need a `/cmd@bot` target, which the composer's simple list cannot
 * express, so the list stays a one-to-one feature.
 */
export async function botCommands(
  deps: Pick<ActionDeps, 'invoke'>,
  chatId: number,
): Promise<BotCommandsAnswer> {
  const chat = (await deps.invoke({ _: 'getChat', chat_id: chatId })) as TdObject
  const type = chat?.type
  if (type?._ !== 'chatTypePrivate') return NO_BOT
  const userId = Number(type.user_id) || 0
  if (!userId) return NO_BOT

  const user = (await deps.invoke({ _: 'getUser', user_id: userId })) as TdObject
  if (user?.type?._ !== 'userTypeBot') return NO_BOT

  const full = (await deps.invoke({
    _: 'getUserFullInfo',
    user_id: userId,
  })) as TdObject | undefined
  const commands = asArray<TdObject>(full?.bot_info?.commands)
    .map(commandOf)
    .filter((command): command is BotCommand => command !== null)
  return { isBot: true, commands }
}

/** One `botCommand`: TDLib stores the text without the leading '/'. */
function commandOf(raw: TdObject | undefined): BotCommand | null {
  const command = String(raw?.command ?? '')
    .trim()
    .replace(/^\//, '')
  if (!command) return null
  return {
    command,
    description: typeof raw?.description === 'string' ? raw.description : '',
  }
}

/**
 * Presses one inline keyboard button: TDLib's `getCallbackQueryAnswer`.
 *
 * The button's payload is posted back verbatim. A game button names the game
 * attached to the message instead (`messageGame.game.short_name`), and a button
 * that asks for the 2-step password needs a password prompt this client does not
 * have — refusing it is honest, and the renderer says so before the call.
 */
export async function pressCallback(
  deps: Pick<ActionDeps, 'invoke'>,
  input: { chatId: number; messageId: number; callback: InlineButtonCallback },
): Promise<CallbackAnswer> {
  const payload = payloadOf(input.callback)
  const answer = (await deps.invoke({
    _: 'getCallbackQueryAnswer',
    chat_id: input.chatId,
    message_id: input.messageId,
    payload,
  })) as TdObject | undefined

  const text = typeof answer?.text === 'string' ? answer.text.trim() : ''
  const url = typeof answer?.url === 'string' ? answer.url.trim() : ''
  return {
    ...(text ? { text } : {}),
    ...(answer?.show_alert === true ? { showAlert: true } : {}),
    ...(url ? { url } : {}),
  }
}

/**
 * inline 机器人 (§8.3): what one `@bot query` answers.
 *
 * The composer only knows the username the reader typed, so the bot is resolved
 * first (`searchPublicChat` — a server call the first time, its own cache after)
 * and checked to be a bot: asking a person for inline results is a TDLib error
 * this client should never produce. `getInlineQueryResults` then answers a page;
 * `offset` is the previous answer's `nextOffset`.
 */
export async function inlineQuery(
  deps: Pick<ActionDeps, 'invoke'>,
  input: { chatId: number; username: string; query: string; offset?: string },
): Promise<InlineQueryAnswer> {
  const botUserId = await inlineBotUserId(deps, input.username)
  const answer = (await deps.invoke({
    _: 'getInlineQueryResults',
    bot_user_id: botUserId,
    chat_id: input.chatId,
    query: input.query,
    offset: input.offset ?? '',
  })) as TdObject
  return mapInlineResults(answer)
}

/**
 * Sends one inline result into the chat (`sendInlineQueryResultMessage`).
 *
 * The bot builds the message — text, media, sticker, whatever its result said —
 * so nothing is composed here: TDLib answers the row it created, exactly like a
 * `sendMessage`, and the renderer appends it and lets the send-succeeded update
 * re-key it. `hide_via_bot` stays false: the official clients only hide the
 * "via @bot" line for Telegram's own gif/photo search bots.
 */
export async function sendInlineResult(
  deps: Pick<ActionDeps, 'invoke' | 'mapper'>,
  input: { chatId: number; topicId?: number; queryId: string; resultId: string },
): Promise<{ localId: string; message: Message }> {
  const response = (await deps.invoke({
    _: 'sendInlineQueryResultMessage',
    chat_id: input.chatId,
    topic_id: topicRef(input.topicId),
    reply_to: replyTo(),
    options: null,
    query_id: input.queryId,
    result_id: input.resultId,
    hide_via_bot: false,
  })) as TdObject
  const message = await mapMessage(deps.mapper, input.chatId, response)
  return { localId: `td-${message.id}`, message }
}

/**
 * The user id behind an inline bot's @username.
 *
 * A username that resolves to something other than a private bot is refused
 * here, with the reader's words, instead of surfacing TDLib's own error.
 */
async function inlineBotUserId(
  deps: Pick<ActionDeps, 'invoke'>,
  username: string,
): Promise<number> {
  const handle = username.replace(/^@/, '').trim()
  let chat: TdObject | undefined
  try {
    chat = (await deps.invoke({ _: 'searchPublicChat', username: handle })) as TdObject
  } catch {
    throw new AppError('invalid_payload', `找不到 @${handle}`)
  }
  const type = chat?.type
  const userId = Number(type?._ === 'chatTypePrivate' ? type.user_id : 0) || 0
  if (!userId) throw new AppError('invalid_payload', `@${handle} 不是机器人`)
  const user = (await deps.invoke({ _: 'getUser', user_id: userId })) as TdObject
  if (user?.type?._ !== 'userTypeBot') {
    throw new AppError('invalid_payload', `@${handle} 不是机器人`)
  }
  return userId
}

function payloadOf(callback: InlineButtonCallback): TdObject {
  switch (callback.type) {
    case 'game':
      return { _: 'callbackQueryPayloadGame', game_short_name: callback.gameShortName }
    case 'password':
      throw new AppError('not_implemented', '需要两步验证密码的按钮暂未支持')
    default:
      return { _: 'callbackQueryPayloadData', data: callback.data }
  }
}
