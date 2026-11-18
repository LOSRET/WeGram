import { describe, expect, it } from 'vitest'

import { EMOJI, RECENT_EMOJI_LIMIT, mergeRecentEmoji, searchEmoji } from './emoji'

describe('EMOJI catalogue', () => {
  it('lists every glyph once, so a grid key or a recent row cannot duplicate', () => {
    const chars = EMOJI.map((item) => item.char)
    expect(new Set(chars).size).toBe(chars.length)
  })

  it('carries a Chinese name for every entry', () => {
    for (const item of EMOJI) {
      expect(item.char.length).toBeGreaterThan(0)
      expect(item.name.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('mergeRecentEmoji', () => {
  it('puts the newest pick first', () => {
    expect(mergeRecentEmoji(['😀', '😄'], '😄')).toEqual(['😄', '😀'])
  })

  it('caps the row at the client length', () => {
    const previous = Array.from({ length: RECENT_EMOJI_LIMIT }, (_, index) =>
      String.fromCodePoint(0x1f600 + index),
    )
    const merged = mergeRecentEmoji(previous, '🎉')
    expect(merged).toHaveLength(RECENT_EMOJI_LIMIT)
    expect(merged[0]).toBe('🎉')
  })

  it('drops empty strings instead of rendering a blank cell', () => {
    expect(mergeRecentEmoji(['😀', '', '😄'], '😄')).toEqual(['😄', '😀'])
    expect(mergeRecentEmoji(['😀'], '')).toEqual(['😀'])
  })
})

describe('searchEmoji', () => {
  it('matches a name', () => {
    expect(searchEmoji('爱心').map((item) => item.char)).toContain('❤️')
  })

  it('matches a keyword that is not the name', () => {
    expect(searchEmoji('点赞').map((item) => item.char)).toContain('👍')
  })

  it('matches the glyph itself and ignores surrounding spaces', () => {
    expect(searchEmoji('  🎉 ').map((item) => item.char)).toEqual(['🎉'])
  })

  it('returns nothing for an empty query', () => {
    expect(searchEmoji('   ')).toEqual([])
  })
})
