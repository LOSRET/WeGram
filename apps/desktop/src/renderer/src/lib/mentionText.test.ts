import { describe, expect, it } from 'vitest'

import { mentionEntitiesOf } from './mentionText'

describe('mentionEntitiesOf', () => {
  it('finds the username a sticker pack title advertises', () => {
    expect(mentionEntitiesOf('Deepseek Chan @zhxia_cn')).toEqual([
      { type: 'mention', offset: 14, length: 9 },
    ])
  })

  it('covers a name that is the whole string', () => {
    expect(mentionEntitiesOf('@zhxia_cn')).toEqual([{ type: 'mention', offset: 0, length: 9 }])
  })

  it('finds every name in a title', () => {
    expect(mentionEntitiesOf('@alpha_one × @beta_two')).toEqual([
      { type: 'mention', offset: 0, length: 10 },
      { type: 'mention', offset: 13, length: 9 },
    ])
  })

  it('does not treat an email address as a mention', () => {
    expect(mentionEntitiesOf('team@example.com')).toEqual([])
  })

  it('needs the @ to start a word', () => {
    expect(mentionEntitiesOf('x@zhxia_cn')).toEqual([])
  })

  it('keeps trailing punctuation out of the name', () => {
    expect(mentionEntitiesOf('by @zhxia_cn, thanks')).toEqual([
      { type: 'mention', offset: 3, length: 9 },
    ])
  })

  it('accepts punctuation in front of the name', () => {
    expect(mentionEntitiesOf('(@zhxia_cn)')).toEqual([{ type: 'mention', offset: 1, length: 9 }])
  })

  it('ignores names shorter than five characters', () => {
    expect(mentionEntitiesOf('@all and @2024')).toEqual([])
  })

  it('stops at 32 characters, like a username does', () => {
    const name = 'a'.repeat(32)
    expect(mentionEntitiesOf('@' + name)).toEqual([{ type: 'mention', offset: 0, length: 33 }])
    expect(mentionEntitiesOf('@' + name + 'b')).toEqual([])
  })

  it('finds nothing in a title without a username', () => {
    expect(mentionEntitiesOf('Deepseek Chan')).toEqual([])
    expect(mentionEntitiesOf('')).toEqual([])
  })
})
