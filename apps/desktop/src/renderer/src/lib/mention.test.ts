import { describe, expect, it } from 'vitest'

import { isSelfMention, mentionTarget } from './mention'

describe('mentionTarget', () => {
  it('resolves an @username mention to the name the adapter searches for', () => {
    expect(mentionTarget('@ada_lovelace', { type: 'mention' })).toEqual({
      kind: 'username',
      username: 'ada_lovelace',
    })
  })

  it('resolves a mentionName to the user id it carries', () => {
    expect(mentionTarget('陈晨', { type: 'mentionName', userId: 23 })).toEqual({
      kind: 'user',
      userId: 23,
    })
  })

  it('refuses a mentionName without a usable id', () => {
    expect(mentionTarget('陈晨', { type: 'mentionName' })).toBeNull()
    expect(mentionTarget('陈晨', { type: 'mentionName', userId: 0 })).toBeNull()
    expect(mentionTarget('陈晨', { type: 'mentionName', userId: 1.5 })).toBeNull()
  })

  it('leaves @all alone: it names a group, not one conversation', () => {
    expect(mentionTarget('@all', { type: 'mention' })).toBeNull()
    expect(mentionTarget('@ALL', { type: 'mention' })).toBeNull()
  })

  it('only accepts what a Telegram username can look like', () => {
    expect(mentionTarget('@ada lovelace', { type: 'mention' })).toBeNull()
    expect(mentionTarget('ada_lovelace', { type: 'mention' })).toBeNull()
    expect(mentionTarget('@ada-lovelace', { type: 'mention' })).toBeNull()
    // The @ is the only decoration the entity covers.
    expect(mentionTarget('  @ada  ', { type: 'mention' })).toEqual({
      kind: 'username',
      username: 'ada',
    })
  })

  it('is not a mention for any other entity', () => {
    expect(mentionTarget('@ada', { type: 'hashtag' })).toBeNull()
    expect(mentionTarget('@ada', { type: 'bold' })).toBeNull()
  })
})

describe('isSelfMention', () => {
  const self = { id: 1000, username: 'wegram_demo' }

  it('matches the account by id and by username, case-insensitively', () => {
    expect(isSelfMention({ kind: 'user', userId: 1000 }, self)).toBe(true)
    expect(isSelfMention({ kind: 'username', username: 'WeGram_Demo' }, self)).toBe(true)
  })

  it('does not match somebody else, or an account without a username', () => {
    expect(isSelfMention({ kind: 'user', userId: 7 }, self)).toBe(false)
    expect(isSelfMention({ kind: 'username', username: 'ada' }, self)).toBe(false)
    expect(isSelfMention({ kind: 'username', username: 'ada' }, { id: 1000 })).toBe(false)
  })
})
