import { describe, expect, it } from 'vitest'

import { stickerSetLink } from './stickerSetLink'

describe('stickerSetLink', () => {
  it('builds the t.me/addstickers link the clients share', () => {
    expect(stickerSetLink('deepseek_chan')).toBe('https://t.me/addstickers/deepseek_chan')
  })

  it('answers null for a set with no name', () => {
    expect(stickerSetLink(undefined)).toBeNull()
    expect(stickerSetLink('')).toBeNull()
  })

  it('refuses a name that is not a Telegram short name', () => {
    expect(stickerSetLink('a b')).toBeNull()
    expect(stickerSetLink('x/y')).toBeNull()
    expect(stickerSetLink('https://evil.example')).toBeNull()
  })
})
