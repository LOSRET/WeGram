import type { MessageEntity } from '@wechatgram/protocol'
import { describe, expect, it } from 'vitest'

import { segmentText } from './entities'

const bold = (offset: number, length: number): MessageEntity => ({
  type: 'bold',
  offset,
  length,
})
const italic = (offset: number, length: number): MessageEntity => ({
  type: 'italic',
  offset,
  length,
})

/** Flattens segments back into "text|types" pairs, which is what RichText renders. */
function flatten(text: string, entities: MessageEntity[] | undefined): string[] {
  return segmentText(text, entities).map(
    (segment) =>
      `${segment.text}|${segment.entities.map((entity) => entity.type).join(',') || '-'}`,
  )
}

describe('segmentText', () => {
  it('returns no segments for empty text', () => {
    expect(segmentText('', undefined)).toEqual([])
  })

  it('returns one bare segment when there are no entities', () => {
    expect(flatten('hello', [])).toEqual(['hello|-'])
    expect(flatten('hello', undefined)).toEqual(['hello|-'])
  })

  it('splits at an entity boundary and keeps the wrapper segments', () => {
    // "ab" bold "cd"
    expect(flatten('abcd', [bold(0, 2)])).toEqual(['ab|bold', 'cd|-'])
  })

  it('supports an entity in the middle of the text', () => {
    expect(flatten('abcdef', [bold(2, 2)])).toEqual(['ab|-', 'cd|bold', 'ef|-'])
  })

  it('carries both types on an overlap and sorts them by name', () => {
    // bold 0..4 overlaps italic 2..6, so 2..4 has both.
    expect(flatten('abcdef', [bold(0, 4), italic(2, 4)])).toEqual([
      'ab|bold',
      'cd|bold,italic',
      'ef|italic',
    ])
  })

  it('treats a nested, fully covered entity as an extra type on the segment', () => {
    expect(flatten('abcdef', [bold(0, 6), italic(1, 2)])).toEqual([
      'a|bold',
      'bc|bold,italic',
      'def|bold',
    ])
  })

  it('merges adjacent ranges that end up with the same entity set', () => {
    // Two touching bold entities render as one segment, not two.
    expect(flatten('abcd', [bold(0, 2), bold(2, 2)])).toEqual(['abcd|bold'])
  })

  it('offsets are UTF-16 code units, so an emoji does not shift the entity', () => {
    // "😀" is two UTF-16 units: bold must land on "cd", not on half the surrogate.
    const text = '😀cd'
    expect(flatten(text, [bold(2, 2)])).toEqual(['😀|-', 'cd|bold'])
  })

  it('clamps out-of-range entities instead of throwing', () => {
    expect(flatten('ab', [bold(1, 99)])).toEqual(['a|-', 'b|bold'])
    expect(flatten('ab', [bold(99, 5)])).toEqual(['ab|-'])
  })

  it('drops entities with a zero or negative length', () => {
    expect(flatten('abc', [bold(1, 0), italic(0, -2)])).toEqual(['abc|-'])
  })

  it('keeps the optional entity fields that RichText needs', () => {
    const [segment] = segmentText('link', [
      { type: 'textUrl', offset: 0, length: 4, url: 'https://example.com' },
    ])
    expect(segment?.entities).toEqual([{ type: 'textUrl', url: 'https://example.com' }])
  })

  it('keeps a custom-emoji id so the renderer can swap in the sticker', () => {
    const [segment] = segmentText('x', [
      { type: 'customEmoji', offset: 0, length: 1, customEmojiId: 5368324170671202286 },
    ])
    expect(segment?.entities).toEqual([{ type: 'customEmoji', customEmojiId: 5368324170671202286 }])
  })
})
