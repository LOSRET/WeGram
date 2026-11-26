import { describe, expect, it } from 'vitest'

import {
  buttonStyleOf,
  buttonTarget,
  inlineButtonOf,
  isKeyboardRemoved,
  mapForceReply,
  mapReplyKeyboard,
  mapReplyMarkup,
} from './buttons'

/**
 * Buttons are read from two TDLib shapes (reply markup and rich page rows) but
 * share one address rule. A link opens, a bot callback carries the payload it
 * posts, and anything else must stay inert instead of looking pressable and
 * doing nothing.
 */
describe('buttonTarget', () => {
  it('reads the url of every link-carrying button type', () => {
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeUrl', url: 'https://x.test' })).toEqual({
      url: 'https://x.test',
    })
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeLoginUrl', url: 'https://l.test' })).toEqual({
      url: 'https://l.test',
    })
    // A Mini App travels under its own field: its URL must go through
    // `openWebApp` before the page may load (design doc §9.4).
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeWebApp', url: 'https://w.test' })).toEqual({
      webAppUrl: 'https://w.test',
    })
  })

  it('carries the payload a callback button posts back to its bot', () => {
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeCallback', data: 'x' })).toEqual({
      callback: { type: 'data', data: 'x' },
    })
    // The password flavour posts the same payload, but needs a password prompt
    // this client has no UI for — the kind stays so the caller can say so.
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeCallbackWithPassword', data: 'x' })).toEqual({
      callback: { type: 'password', data: 'x' },
    })
  })

  it('names the game a game button starts, and leaves it inert without one', () => {
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeCallbackGame' }, 'tetris')).toEqual({
      callback: { type: 'game', gameShortName: 'tetris' },
    })
    // A game button only exists under a messageGame; anything else cannot post.
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeCallbackGame' })).toEqual({})
  })

  it('leaves the other kinds inert', () => {
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeCopyText', text: 'hi' })).toEqual({})
    expect(buttonTarget({ _: 'inlineKeyboardButtonTypeSwitchInline', query: 'x' })).toEqual({})
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
    ).toEqual({ text: '确认', callback: { type: 'data', data: 'a' }, style: 'success' })
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
      [{ text: '客服', callback: { type: 'data', data: 'a' } }, { text: '复制' }],
    ])
  })

  it('hands the message game down to a game button', () => {
    const rows = mapReplyMarkup(
      {
        _: 'replyMarkupInlineKeyboard',
        force_reply: false,
        rows: [
          [
            {
              _: 'inlineKeyboardButton',
              text: '开始游戏',
              type: { _: 'inlineKeyboardButtonTypeCallbackGame' },
            },
          ],
        ],
      },
      'tetris',
    )
    expect(rows).toEqual([
      [{ text: '开始游戏', callback: { type: 'game', gameShortName: 'tetris' } }],
    ])
  })

  it('ignores markup that is not an inline keyboard, and empty keyboards', () => {
    expect(mapReplyMarkup({ _: 'replyMarkupShowKeyboard', rows: [] })).toBeUndefined()
    expect(mapReplyMarkup(undefined)).toBeUndefined()
    expect(mapReplyMarkup({ _: 'replyMarkupInlineKeyboard', rows: [[]] })).toBeUndefined()
  })
})

/**
 * The custom reply keyboard is the other markup a bot sends (§8.3). Its keys are
 * drawn either way, but only a text key may be sent as a message: the request
 * kinds ask for a phone number / a location, which this client cannot produce.
 */
describe('mapReplyKeyboard', () => {
  it('maps the rows, the one-time flag and the placeholder', () => {
    expect(
      mapReplyKeyboard({
        _: 'replyMarkupShowKeyboard',
        rows: [
          [
            { _: 'keyboardButton', text: '今日推荐', type: { _: 'keyboardButtonTypeText' } },
            { _: 'keyboardButton', text: ' 设置提醒 ', type: { _: 'keyboardButtonTypeText' } },
          ],
          [
            {
              _: 'keyboardButton',
              text: '分享手机号',
              type: { _: 'keyboardButtonTypeRequestPhoneNumber' },
            },
          ],
          [
            {
              _: 'keyboardButton',
              text: '首页',
              type: { _: 'keyboardButtonTypeWebApp', url: 'https://w.test/app' },
            },
          ],
        ],
        is_persistent: false,
        resize_keyboard: true,
        one_time: true,
        input_field_placeholder: '点下面的按钮，或输入 /help',
      }),
    ).toEqual({
      rows: [
        [
          { text: '今日推荐', sendsText: true },
          { text: '设置提醒', sendsText: true },
        ],
        [{ text: '分享手机号', sendsText: false }],
        [{ text: '首页', sendsText: false, webAppUrl: 'https://w.test/app' }],
      ],
      oneTime: true,
      placeholder: '点下面的按钮，或输入 /help',
    })
  })

  it('drops blank keys and empty rows instead of drawing holes', () => {
    expect(
      mapReplyKeyboard({
        _: 'replyMarkupShowKeyboard',
        rows: [
          [{ _: 'keyboardButton', text: '   ', type: { _: 'keyboardButtonTypeText' } }],
          [{ _: 'keyboardButton', text: '重试', type: { _: 'keyboardButtonTypeText' } }],
        ],
      }),
    ).toEqual({ rows: [[{ text: '重试', sendsText: true }]] })
  })

  it('keeps a key without a text type inert, and ignores other markups', () => {
    expect(
      mapReplyKeyboard({
        _: 'replyMarkupShowKeyboard',
        rows: [[{ _: 'keyboardButton', text: '打开小程序' }]],
      }),
    ).toEqual({ rows: [[{ text: '打开小程序', sendsText: false }]] })
    expect(mapReplyKeyboard({ _: 'replyMarkupInlineKeyboard', rows: [] })).toBeUndefined()
    expect(mapReplyKeyboard({ _: 'replyMarkupShowKeyboard', rows: [] })).toBeUndefined()
    expect(mapReplyKeyboard(undefined)).toBeUndefined()
  })
})

/**
 * The other two things a bot can do to the keyboard area (§8.3): take its grid
 * away, or ask for a direct answer to one row.
 */
describe('isKeyboardRemoved', () => {
  it('recognises the removal markup only', () => {
    expect(isKeyboardRemoved({ _: 'replyMarkupRemoveKeyboard' })).toBe(true)
    expect(isKeyboardRemoved({ _: 'replyMarkupShowKeyboard', rows: [] })).toBe(false)
    expect(isKeyboardRemoved({ _: 'replyMarkupInlineKeyboard', rows: [] })).toBe(false)
    expect(isKeyboardRemoved(undefined)).toBe(false)
  })
})

describe('mapForceReply', () => {
  it('maps the placeholder the bot named', () => {
    expect(
      mapForceReply({ _: 'replyMarkupForceReply', is_personal: true, placeholder: ' 写下答案 ' }),
    ).toEqual({ placeholder: '写下答案' })
  })

  it('maps a marker without a placeholder', () => {
    expect(
      mapForceReply({ _: 'replyMarkupForceReply', is_personal: true, placeholder: '' }),
    ).toEqual({})
  })

  it('ignores every other markup', () => {
    expect(mapForceReply({ _: 'replyMarkupShowKeyboard', rows: [] })).toBeUndefined()
    expect(mapForceReply({ _: 'replyMarkupRemoveKeyboard' })).toBeUndefined()
    expect(mapForceReply(undefined)).toBeUndefined()
  })
})
