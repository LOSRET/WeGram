import { describe, expect, it } from 'vitest'

import { mapEntities } from './entities'

/**
 * Offsets are UTF-16 code units as delivered by TDLib and consumed by
 * `lib/entities.ts` in the renderer — no conversion here on purpose.
 */
describe('mapEntities', () => {
  it('maps every supported entity type', () => {
    const entities = mapEntities([
      { type: { _: 'textEntityTypeBold' }, offset: 0, length: 1 },
      { type: { _: 'textEntityTypeItalic' }, offset: 1, length: 1 },
      { type: { _: 'textEntityTypeUnderline' }, offset: 2, length: 1 },
      { type: { _: 'textEntityTypeStrikethrough' }, offset: 3, length: 1 },
      { type: { _: 'textEntityTypeCode' }, offset: 4, length: 1 },
      { type: { _: 'textEntityTypePre' }, offset: 5, length: 1 },
      { type: { _: 'textEntityTypePreCode' }, offset: 6, length: 1, language: 'ts' },
      { type: { _: 'textEntityTypeUrl' }, offset: 7, length: 1 },
      { type: { _: 'textEntityTypeTextUrl' }, offset: 8, length: 1, url: 'https://example.com' },
      { type: { _: 'textEntityTypeMention' }, offset: 9, length: 1 },
      { type: { _: 'textEntityTypeHashtag' }, offset: 10, length: 1 },
      { type: { _: 'textEntityTypeSpoiler' }, offset: 11, length: 1 },
      { type: { _: 'textEntityTypeCustomEmoji', custom_emoji_id: 900 }, offset: 12, length: 1 },
    ])

    expect(entities.map((entity) => entity.type)).toEqual([
      'bold',
      'italic',
      'underline',
      'strikethrough',
      'code',
      'pre',
      'pre',
      'url',
      'textUrl',
      'mention',
      'hashtag',
      'spoiler',
      'customEmoji',
    ])
    expect(entities[6]).toEqual({ type: 'pre', offset: 6, length: 1, language: 'ts' })
    expect(entities[8]).toEqual({
      type: 'textUrl',
      offset: 8,
      length: 1,
      url: 'https://example.com',
    })
    expect(entities[12]).toEqual({
      type: 'customEmoji',
      offset: 12,
      length: 1,
      customEmojiId: 900,
    })
  })

  it('drops unknown entity types instead of guessing', () => {
    expect(
      mapEntities([{ type: { _: 'textEntityTypeBankCardNumber' }, offset: 0, length: 4 }]),
    ).toEqual([])
  })

  it('tolerates missing offsets and lengths', () => {
    expect(mapEntities([{ type: { _: 'textEntityTypeBold' } }])).toEqual([
      { type: 'bold', offset: 0, length: 0 },
    ])
  })

  it('returns an empty list for missing input', () => {
    expect(mapEntities(undefined)).toEqual([])
  })
})
