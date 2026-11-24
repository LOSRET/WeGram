import { describe, expect, it } from 'vitest'

import { mapInlineResult, mapInlineResults } from './inline'

/**
 * Inline results (§8.3): twelve TDLib shapes, one row each. The mapper is the
 * only place that reads a result's own payload, so these tests pin one example
 * per shape family rather than every field.
 */
describe('mapInlineResults', () => {
  it('keeps the query id, the cursor and one row per result', () => {
    expect(
      mapInlineResults({
        _: 'inlineQueryResults',
        inline_query_id: '1234567890123456789',
        next_offset: 'next-page',
        results: [
          {
            _: 'inlineQueryResultArticle',
            id: 'a1',
            url: 'https://example.test/a',
            title: '示例文章',
            description: '一句话说明',
            thumbnail: { _: 'thumbnail', file: { id: 77 } },
          },
        ],
      }),
    ).toEqual({
      // int64 ids travel as strings: a number past 2^53 would lose digits.
      queryId: '1234567890123456789',
      nextOffset: 'next-page',
      results: [
        {
          id: 'a1',
          kind: '文章',
          title: '示例文章',
          description: '一句话说明',
          thumbFileId: 77,
        },
      ],
    })
  })

  it('answers an empty page instead of throwing when the bot sent nothing', () => {
    expect(mapInlineResults(undefined)).toEqual({ queryId: '', nextOffset: '', results: [] })
  })

  it('drops a result this client draws nothing for', () => {
    expect(
      mapInlineResults({
        _: 'inlineQueryResults',
        inline_query_id: '1',
        next_offset: '',
        results: [{ _: 'somethingNew', id: 'x' }],
      }).results,
    ).toEqual([])
  })
})

describe('mapInlineResult', () => {
  it("reads a photo's largest size as its thumbnail", () => {
    expect(
      mapInlineResult({
        _: 'inlineQueryResultPhoto',
        id: 'p1',
        title: '猫',
        description: '一只猫',
        photo: {
          sizes: [
            { width: 100, height: 100, photo: { id: 11 } },
            { width: 800, height: 800, photo: { id: 12 } },
          ],
        },
      }),
    ).toEqual({ id: 'p1', kind: '图片', title: '猫', description: '一只猫', thumbFileId: 12 })
  })

  it('names a person by their name and a sticker by its emoji', () => {
    expect(
      mapInlineResult({
        _: 'inlineQueryResultContact',
        id: 'c1',
        contact: { first_name: '小', last_name: '明', phone_number: '8613800000000' },
      }),
    ).toEqual({
      id: 'c1',
      kind: '联系人',
      title: '小 明',
      description: '8613800000000',
    })
    expect(
      mapInlineResult({ _: 'inlineQueryResultSticker', id: 's1', sticker: { emoji: '😀' } }),
    ).toEqual({ id: 's1', kind: '贴纸', title: '😀' })
  })

  it("keeps a voice note's length as the second line", () => {
    expect(
      mapInlineResult({
        _: 'inlineQueryResultVoiceNote',
        id: 'v1',
        title: '语音',
        voice_note: { duration: 65 },
      }),
    ).toEqual({ id: 'v1', kind: '语音', title: '语音', description: '1:05' })
  })

  it('drops a result with no id: nothing could be sent back for it', () => {
    expect(mapInlineResult({ _: 'inlineQueryResultArticle', id: '   ', title: 'x' })).toBeNull()
  })
})
