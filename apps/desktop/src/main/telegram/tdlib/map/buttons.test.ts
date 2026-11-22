import { describe, expect, it } from 'vitest'

import { buttonStyleOf, buttonTarget, inlineButtonOf, mapReplyMarkup } from './buttons'

/**
 * Buttons are read from two TDLib shapes (reply markup and rich page rows) but
 * share one address rule. Anything that is not a link or a bot callback must stay
 * inert instead of looking pressable and doing nothing.
 */
describe('buttonTarget', () => {
  it('reads the url of every link-carrying button type', () => {
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeUrl', url: 'https://x.test' })).toEqual({
      url: 'https://x.test',
    })
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeLoginUrl', url: 'https://l.test' })).toEqual({
      url: 'https://l.test',
    })
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeWebApp', url: 'https://w.test' })).toEqual({
      url: 'https://w.test',
    })
  })

  it('marks bot callbacks and leaves the other kinds inert', () => {
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeCallback', data: 'x' })).toEqual({
      callback: true,
    })
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeCallbackWithPassword', data: 'x' })).toEqual({
      callback: true,
    })
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeCopyText', text: 'hi' })).toEqual({})
    expect(buttonTarget(undefined)).toEqual({})
  })

  it('drops a button with no visible text', () => {
    expect(
      inlineButtonOf({ type: { _: 'inlineKeyboardButtonTypeUrl', url: 'https://x' } }, '   '),
    ).toBeNull()
  })
})

describe('buttonStyleOf', () => {
  it('maps the four styles a bot can set and leaves the rest alone', () => {
    expect(buttonStyleOf({ _: 'buttonStylePrimary' })).toBe('primary')
    expect(buttonStyleOf({ _: 'buttonStyleDanger' })).toBe('danger')
    expect(buttonStyleOf({ _: 'buttonStyleSuccess' })).toBe('success')
    expect(buttonStyleOf({ _: 'buttonStyleLink' })).toBe('link')
    // The ordinary button and any style we do not know stay unstyled.
    expect(buttonStyleOf({ _: 'buttonStyleDefault' })).toBeUndefined()
    expect(buttonStyleOf({ _: 'buttonStyleWhatever' })).toBeUndefined()
    expect(buttonStyleOf(undefined)).toBeUndefined()
  })

  it('carries the style into the DTO only when there is one', () => {
    expect(
      inlineButtonOf(
        {
          text: '确认',
          style: { _: 'buttonStyleSuccess' },
          type: { _: 'inlineKeyboardButtonTypeCallback', data: 'a' },
        },
        '确认',
      ),
    ).toEqual({ text: '确认', callback: true, style: 'success' })
    expect(inlineButtonOf({ text: '普通' }, '普通')).toEqual({ text: '普通' })
  })
})

describe('mapReplyMarkup', () => {
  it('maps an inline keyboard row by row', () => {
    const rows = mapReplyMarkup({
      _: 'replyMarkupInlineKeyboard',
      force_reply: false,
      rows: [
        [
          {
            _: 'inlineKeyboardButton',
            text: '打开',
            type: { _: 'inlineKeyboardButtonTypeUrl', url: 'https://x.test' },
          },
        ],
        [
          {
            _: 'inlineKeyboardButton',
            text: '客服',
            type: { _: 'inlineKeyboardButtonTypeCallback', data: 'a' },
          },
          {
            _: 'inlineKeyboardButton',
            text: '复制',
            type: { _: 'inlineKeyboardButtonTypeCopyText', text: 't' },
          },
        ],
      ],
    })

    expect(rows).toEqual([
      [{ text: '打开', url: 'https://x.test' }],
      [{ text: '客服', callback: true }, { text: '复制' }],
    ])
  })

  it('ignores markup that is not an inline keyboard, and empty keyboards', () => {
    expect(mapReplyMarkup({ _: 'replyMarkupShowKeyboard', rows: [] })).toBeUndefined()
    expect(mapReplyMarkup(undefined)).toBeUndefined()
    expect(mapReplyMarkup({ _: 'replyMarkupInlineKeyboard', rows: [[]] })).toBeUndefined()
  })
})
