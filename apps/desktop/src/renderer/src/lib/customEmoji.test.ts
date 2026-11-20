import { describe, expect, it } from 'vitest'

import { CUSTOM_EMOJI_BATCH, chunkIds } from './customEmoji'

describe('chunkIds', () => {
  it('keeps one call for an ordinary post', () => {
    expect(chunkIds(['1', '2', '3'])).toEqual([['1', '2', '3']])
  })

  it('splits at the 200-id cap TDLib enforces', () => {
    const ids = Array.from({ length: CUSTOM_EMOJI_BATCH + 2 }, (_, index) => String(index + 1))
    const chunks = chunkIds(ids)
    expect(chunks.map((chunk) => chunk.length)).toEqual([CUSTOM_EMOJI_BATCH, 2])
    expect(chunks[1]).toEqual(['201', '202'])
  })

  it('has nothing to ask for when the list is empty', () => {
    expect(chunkIds([])).toEqual([])
  })
})
