import { describe, expect, it } from 'vitest'

import { telegramLinkTarget } from './telegramLink'

/**
 * TDLib message ids are the server post number shifted left by 20, while a
 * `t.me` link carries the plain number. The parser converts; these expectations
 * are the conversion, so a regression shows up as a mismatch here.
 */
const tdlibId = (post: number): number => post * 2 ** 20

describe('telegramLinkTarget', () => {
  describe('t.me', () => {
    it('reads a username and, when present, the post below it', () => {
      expect(telegramLinkTarget('https://t.me/ada_lovelace')).toEqual({
        kind: 'username',
        username: 'ada_lovelace',
      })
      expect(telegramLinkTarget('https://t.me/ada_lovelace/701')).toEqual({
        kind: 'username',
        username: 'ada_lovelace',
        messageId: tdlibId(701),
      })
      // The official clients add ?single when a link is shared from a post.
      expect(telegramLinkTarget('http://t.me/ada_lovelace/701?single')).toEqual({
        kind: 'username',
        username: 'ada_lovelace',
        messageId: tdlibId(701),
      })
    })

    it('shifts a link post number into the id space TDLib pages from', () => {
      // 24 is a real post number, but not a TDLib message id (the low 20 bits of
      // a MessageId are the type tag), so sending it raw made TDLib answer 400
      // "Invalid value of parameter from_message_id specified".
      expect(telegramLinkTarget('https://t.me/zaihuapd/24')).toEqual({
        kind: 'username',
        username: 'zaihuapd',
        messageId: 24 * 2 ** 20,
      })
    })

    it('tolerates the mirror hostnames and the /s/ preview path', () => {
      expect(telegramLinkTarget('https://www.telegram.me/ada_lovelace')).toEqual({
        kind: 'username',
        username: 'ada_lovelace',
      })
      expect(telegramLinkTarget('https://telegram.dog/ada_lovelace/7')).toEqual({
        kind: 'username',
        username: 'ada_lovelace',
        messageId: tdlibId(7),
      })
      expect(telegramLinkTarget('https://t.me/s/wegram_news/12')).toEqual({
        kind: 'username',
        username: 'wegram_news',
        messageId: tdlibId(12),
      })
    })

    it('maps a private channel link onto its TDLib chat id', () => {
      // t.me/c/<supergroup id>/<post>; TDLib chat ids are -1000000000000 - id.
      expect(telegramLinkTarget('https://t.me/c/1234567890/42')).toEqual({
        kind: 'chat',
        chatId: -1001234567890,
        messageId: tdlibId(42),
      })
      expect(telegramLinkTarget('https://t.me/c/1234567890')).toEqual({
        kind: 'chat',
        chatId: -1001234567890,
      })
    })

    it('refuses links that need an action this client cannot perform', () => {
      expect(telegramLinkTarget('https://t.me/+AbCdEf123')).toBeNull()
      expect(telegramLinkTarget('https://t.me/joinchat/AAAAAEF')).toBeNull()
      expect(telegramLinkTarget('https://t.me/addstickers/wegram')).toBeNull()
      expect(telegramLinkTarget('https://t.me/share/url?url=https%3A%2F%2Ft.me')).toBeNull()
      expect(telegramLinkTarget('https://t.me/proxy?server=example.com')).toBeNull()
    })

    it('refuses malformed paths instead of guessing a chat', () => {
      expect(telegramLinkTarget('https://t.me/')).toBeNull()
      expect(telegramLinkTarget('https://t.me/ada_lovelace/notanumber')).toBeNull()
      expect(telegramLinkTarget('https://t.me/c/notanumber/7')).toBeNull()
      expect(telegramLinkTarget('https://t.me/ada-lovelace')).toBeNull()
      expect(telegramLinkTarget('https://t.me/%61da_lovelace')).toBeNull()
    })
  })

  describe('tg://', () => {
    it('reads resolve links, with and without a post', () => {
      expect(telegramLinkTarget('tg://resolve?domain=ada_lovelace')).toEqual({
        kind: 'username',
        username: 'ada_lovelace',
      })
      expect(telegramLinkTarget('tg://resolve?domain=ada_lovelace&post=701')).toEqual({
        kind: 'username',
        username: 'ada_lovelace',
        messageId: tdlibId(701),
      })
      expect(telegramLinkTarget('tg://resolve?domain=')).toBeNull()
    })

    it('reads a user by id', () => {
      expect(telegramLinkTarget('tg://user?id=42')).toEqual({ kind: 'user', userId: 42 })
      expect(telegramLinkTarget('tg://user?id=0')).toBeNull()
      expect(telegramLinkTarget('tg://user?id=abc')).toBeNull()
    })

    it('reads openmessage for a group and for a private chat', () => {
      expect(telegramLinkTarget('tg://openmessage?chat_id=-1001234567890&message_id=42')).toEqual({
        kind: 'chat',
        chatId: -1001234567890,
        messageId: tdlibId(42),
      })
      // A positive chat_id names a person, whose chat opens by user id.
      expect(telegramLinkTarget('tg://openmessage?chat_id=42&message_id=5')).toEqual({
        kind: 'user',
        userId: 42,
      })
      expect(telegramLinkTarget('tg://openmessage?chat_id=0&message_id=5')).toBeNull()
    })

    it('leaves other tg actions to the OS', () => {
      expect(telegramLinkTarget('tg://settings')).toBeNull()
      expect(telegramLinkTarget('tg://join?invite=AAAA')).toBeNull()
      expect(telegramLinkTarget('tg://login?token=abc')).toBeNull()
    })
  })

  it('ignores everything that is not a Telegram link', () => {
    expect(telegramLinkTarget('https://example.com/t.me/ada')).toBeNull()
    expect(telegramLinkTarget('mailto:ada@example.com')).toBeNull()
    expect(telegramLinkTarget('javascript:alert(1)')).toBeNull()
    expect(telegramLinkTarget(undefined)).toBeNull()
  })
})
