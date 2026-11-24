import type { InlineButton, InlineButtonStyle } from '@wegram/protocol'

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
): Pick<InlineButton, 'url' | 'callback'> {
  switch (type?._) {
    case 'inlineKeyboardButtonTypeUrl':
    case 'inlineKeyboardButtonTypeLoginUrl':
    case 'inlineKeyboardButtonTypeWebApp':
      return typeof type.url === 'string' && type.url ? { url: type.url } : {}
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
 * keyboards (`replyMarkupShowKeyboard`) or layout hints, never bubble buttons.
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
