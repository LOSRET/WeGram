import type { InlineButton, InlineButtonStyle } from '@wegram/protocol'

import type { TdObject } from '../client'

/**
 * Inline buttons exist twice in TDLib: `replyMarkupInlineKeyboard` under a
 * message (button text is a plain string) and `pageBlockButtonRow` inside a rich
 * message (text is a rich-text node). Both carry the same `type` union, so the
 * address a button points at is read here once.
 */

/** Where a button leads; nothing means "shown but inert" (copy, switch-inline, disabled). */
export function buttonTarget(type: TdObject | undefined): Pick<InlineButton, 'url' | 'callback'> {
  switch (type?._) {
    case 'inlineKeyboardButtonTypeUrl':
    case 'inlineKeyboardButtonTypeLoginUrl':
    case 'inlineKeyboardButtonTypeWebApp':
      return typeof type.url === 'string' && type.url ? { url: type.url } : {}
    case 'inlineKeyboardButtonTypeCallback':
    case 'inlineKeyboardButtonTypeCallbackWithPassword':
      // Pressing these sends data to a bot; the client renders them but this
      // version does not post a callback query.
      return { callback: true }
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

export function inlineButtonOf(button: TdObject | undefined, text: string): InlineButton | null {
  const label = text.trim()
  if (!label) return null
  const style = buttonStyleOf(button?.style)
  return { text: label, ...buttonTarget(button?.type), ...(style ? { style } : {}) }
}

/**
 * Rows of a message's inline keyboard. Other markup kinds are client-side
 * keyboards (`replyMarkupShowKeyboard`) or layout hints, never bubble buttons.
 */
export function mapReplyMarkup(markup: TdObject | undefined): InlineButton[][] | undefined {
  if (!markup || markup._ !== 'replyMarkupInlineKeyboard') return undefined
  const rows: TdObject[] = Array.isArray(markup.rows) ? markup.rows : []
  const mapped: InlineButton[][] = []
  for (const row of rows) {
    const buttons = (Array.isArray(row) ? row : [])
      .map((button) => inlineButtonOf(button, typeof button?.text === 'string' ? button.text : ''))
      .filter((button): button is InlineButton => button !== null)
    if (buttons.length) mapped.push(buttons)
  }
  return mapped.length ? mapped : undefined
}
