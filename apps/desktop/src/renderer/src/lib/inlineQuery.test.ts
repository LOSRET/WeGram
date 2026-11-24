import { describe, expect, it } from 'vitest'

import { parseInlineQuery } from './inlineQuery'

describe('parseInlineQuery', () => {
  it('reads the handle and the query after the first space', () => {
    expect(parseInlineQuery('@wegram_helper 今日推荐')).toEqual({
      username: 'wegram_helper',
      query: '今日推荐',
    })
  })

  it('keeps spaces inside the query', () => {
    expect(parseInlineQuery('@gif seed cat')).toEqual({ username: 'gif', query: 'seed cat' })
  })

  it('asks for the bot defaults when the query is empty', () => {
    expect(parseInlineQuery('@wegram_helper ')).toEqual({ username: 'wegram_helper', query: '' })
  })

  it('normalises the case Telegram usernames ignore', () => {
    expect(parseInlineQuery('@WeGram_Helper hi')).toEqual({
      username: 'wegram_helper',
      query: 'hi',
    })
  })

  it('is not a query while the handle is still being typed', () => {
    expect(parseInlineQuery('@wegram')).toBeNull()
    expect(parseInlineQuery('@')).toBeNull()
  })

  it('is not a query when the mention is not at the start', () => {
    expect(parseInlineQuery('hi @wegram_helper there')).toBeNull()
    expect(parseInlineQuery('/start @wegram_helper')).toBeNull()
  })

  it('rejects a handle with characters Telegram does not allow', () => {
    expect(parseInlineQuery('@we gram query')).toBeNull()
    expect(parseInlineQuery('@we-gram query')).toBeNull()
  })
})
