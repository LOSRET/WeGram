import { chatSummarySchema, messageSchema } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { buildFixtures } from '../src/main/telegram/mock/fixtures'
import { chats as previewChats } from '../src/renderer/src/lib/preview/fixtures'

/**
 * The two fakes show the same demo account: the Electron mock adapter and the
 * browser preview. Their data is still two copies (merging them needs a shared
 * fixture package with each side's `mediaOf` injected — see
 * docs/REFACTOR-HANDOFF.md), and the copies had already drifted.
 *
 * This is the cheap guard: it does not merge anything, it fails when a reader-
 * visible field of a shared conversation disagrees, and it records the one gap
 * that is still known instead of pretending the sets are equal.
 */

const mock = buildFixtures((fileId) => ({ fileId }))
const mockChats = [...mock.values()].map((fixture) => fixture.chat)
const mockById = new Map(mockChats.map((chat) => [chat.id, chat]))

describe('mock and preview fixtures', () => {
  it('keeps the preview a subset of the mock, with one known gap', () => {
    const previewIds = new Set(previewChats.map((chat) => chat.id))
    for (const chat of previewChats) expect(mockById.has(chat.id)).toBe(true)

    const missing = mockChats
      .map((chat) => chat.id)
      .filter((id) => !previewIds.has(id))
      .sort((a, b) => a - b)
    // 11 is Eva Müller: the preview never got her card. Delete this expectation
    // when the data sets are merged; until then it fails if either side moves.
    expect(missing).toEqual([11])
  })

  it('agrees on everything a conversation row draws', () => {
    for (const chat of previewChats) {
      const peer = mockById.get(chat.id)
      expect(peer?.title).toBe(chat.title)
      expect(peer?.kind).toBe(chat.kind)
      expect(peer?.unread).toBe(chat.unread)
      expect(peer?.pinned).toBe(chat.pinned)
      expect(peer?.muted).toBe(chat.muted)
    }
  })

  it('keeps every mock row protocol-shaped', () => {
    for (const fixture of mock.values()) {
      expect(() => chatSummarySchema.parse(fixture.chat)).not.toThrow()
      for (const message of fixture.messages) {
        expect(() => messageSchema.parse(message)).not.toThrow()
      }
    }
  })
})
