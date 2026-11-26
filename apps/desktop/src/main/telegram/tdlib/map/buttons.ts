import type {
  ForceReply,
  InlineButton,
  InlineButtonStyle,
  ReplyKeyboard,
  ReplyKeyboardButton,
} from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'

/**
 * Inline buttons exist twice in TDLib: `replyMarkupInlineKeyboard` under a
 * message (button text is a plain string) and `pageBlockButtonRow` inside a rich
 * message (text is a rich-text node). Both carry the same `type` union, so the
 * address a button points at is read here once.
 */

/**
 * Where a button leads; nothing means "shown but inert" (copy, switch-inline,
 * disabled).
 *
 * `gameShortName` is the short name of the game the message carries: TDLib's
 * callback-game button does not repeat it, so the caller reads it from
 * `messageGame` — a game button whose message is not a game stays inert.
 */
export function buttonTarget(
  type: TdObject | undefined,
  gameShortName?: string,
): Pick<InlineButton, 'url' | 'webAppUrl' | 'callback'> {
  switch (type?._) {
    case 'inlineKeyboardButtonTypeUrl':
    case 'inlineKeyboardButtonTypeLoginUrl':
      return typeof type.url === 'string' && type.url ? { url: type.url } : {}
    case 'inlineKeyboardButtonTypeWebApp':
      // A Mini App is not a link: the URL must go through `openWebApp` first,
      // which is why it travels under its own field (§9.4).
      return typeof type.url === 'string' && type.url ? { webAppUrl: type.url } : {}
    case 'inlineKeyboardButtonTypeCallback':
    case 'inlineKeyboardButtonTypeCallbackWithPassword': {
      // Pressing these posts the button's payload back to its bot
      // (`getCallbackQueryAnswer`); the payload travels as TDLib gave it (base64).
      const data = typeof type.data === 'string' ? type.data : ''
      return {
        callback:
          type._ === 'inlineKeyboardButtonTypeCallback'
            ? { type: 'data', data }
            : { type: 'password', data },
      }
    }
    case 'inlineKeyboardButtonTypeCallbackGame':
      return gameShortName ? { callback: { type: 'game', gameShortName } } : {}
    default:
      return {}
  }
}

/** TDLib's style object -> the DTO enum; default and unknown stay absent. */
const BUTTON_STYLES: Record<string, InlineButtonStyle> = {
  buttonStylePrimary: 'primary',
  buttonStyleDanger: 'danger',
  buttonStyleSuccess: 'success',
  buttonStyleLink: 'link',
}

export function buttonStyleOf(style: TdObject | undefined): InlineButtonStyle | undefined {
  return BUTTON_STYLES[String(style?._)]
}

export function inlineButtonOf(
  button: TdObject | undefined,
  text: string,
  gameShortName?: string,
): InlineButton | null {
  const label = text.trim()
  if (!label) return null
  const style = buttonStyleOf(button?.style)
  return {
    text: label,
    ...buttonTarget(button?.type, gameShortName),
    ...(style ? { style } : {}),
  }
}

/**
 * Rows of a message's inline keyboard. Other markup kinds are client-side
 * keyboards (`replyMarkupShowKeyboard`, read by `mapReplyKeyboard`) or layout
 * hints, never bubble buttons.
 */
export function mapReplyMarkup(
  markup: TdObject | undefined,
  gameShortName?: string,
): InlineButton[][] | undefined {
  if (!markup || markup._ !== 'replyMarkupInlineKeyboard') return undefined
  const rows: TdObject[] = asArray(markup.rows)
  const mapped: InlineButton[][] = []
  for (const row of rows) {
    const buttons = asArray(row)
      .map((button) =>
        inlineButtonOf(button, typeof button?.text === 'string' ? button.text : '', gameShortName),
      )
      .filter((button): button is InlineButton => button !== null)
    if (buttons.length) mapped.push(buttons)
  }
  return mapped.length ? mapped : undefined
}

/**
 * A bot's custom reply keyboard (`replyMarkupShowKeyboard`), the grid the pane
 * draws under the input (§8.3).
 *
 * Only the parts this client acts on travel: the rows, `one_time` (hide after a
 * press) and `input_field_placeholder` (the box's placeholder). `resize_keyboard`
 * is a sizing hint the card already ignores, and TDLib's newer `is_personal` has
 * no meaning for a client that never shows a keyboard to anyone else.
 */
export function mapReplyKeyboard(markup: TdObject | undefined): ReplyKeyboard | undefined {
  if (markup?._ !== 'replyMarkupShowKeyboard') return undefined
  const rows: TdObject[] = asArray(markup.rows)
  const mapped: ReplyKeyboardButton[][] = []
  for (const row of rows) {
    const buttons = asArray(row)
      .map(replyKeyboardButtonOf)
      .filter((button): button is ReplyKeyboardButton => button !== null)
    if (buttons.length) mapped.push(buttons)
  }
  if (!mapped.length) return undefined
  const placeholder =
    typeof markup.input_field_placeholder === 'string' ? markup.input_field_placeholder.trim() : ''
  return {
    rows: mapped,
    ...(markup.one_time === true ? { oneTime: true } : {}),
    ...(placeholder ? { placeholder } : {}),
  }
}

/**
 * TDLib `replyMarkupRemoveKeyboard`: the bot took its custom keyboard away.
 *
 * The removal row carries no keyboard of its own, so "no `reply_markup` here"
 * alone cannot express it — without this marker the newest *older* keyboard keeps
 * winning and the grid would stay under the input forever (§8.3).
 */
export function isKeyboardRemoved(markup: TdObject | undefined): boolean {
  return markup?._ === 'replyMarkupRemoveKeyboard'
}

/**
 * TDLib `replyMarkupForceReply`: the bot asks for a direct answer to this row.
 *
 * Only the placeholder travels — the reply target *is* the row, and the pane
 * offers it as the reply target (the composer's banner already draws one).
 */
export function mapForceReply(markup: TdObject | undefined): ForceReply | undefined {
  if (markup?._ !== 'replyMarkupForceReply') return undefined
  const placeholder = typeof markup.placeholder === 'string' ? markup.placeholder.trim() : ''
  return placeholder ? { placeholder } : {}
}

/**
 * One `keyboardButton`. Its `type` decides whether the label is a message to send:
 * only `keyboardButtonTypeText` means that. A `keyboardButtonTypeWebApp` carries
 * the URL a Mini App needs (§9.4); every other kind (a phone number, a location,
 * a poll, a chat) is drawn but refuses, because this client cannot ask for it.
 */
function replyKeyboardButtonOf(button: TdObject | undefined): ReplyKeyboardButton | null {
  const text = typeof button?.text === 'string' ? button.text.trim() : ''
  if (!text) return null
  const type = button?.type
  const webAppUrl =
    type?._ === 'keyboardButtonTypeWebApp' && typeof type.url === 'string' && type.url
      ? type.url
      : undefined
  return {
    text,
    sendsText: type?._ === 'keyboardButtonTypeText',
    ...(webAppUrl ? { webAppUrl } : {}),
  }
}
