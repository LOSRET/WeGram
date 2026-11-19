import { RECENT_EMOJI_LIMIT as protocolLimit } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { RECENT_EMOJI_LIMIT as rendererLimit } from '../src/renderer/src/lib/emoji'

/**
 * The picker's 最近使用 cap exists twice on purpose: the protocol schema and main
 * truncate with one copy, the renderer draws with the other. Importing the
 * protocol's value into the renderer would bundle zod and every DTO schema into
 * the sandboxed page (measured: +212 kB), so the copies are pinned here instead.
 */
describe('limits contract', () => {
  it('keeps the renderer picker cap equal to the protocol cap', () => {
    expect(rendererLimit).toBe(protocolLimit)
  })
})
