import type { MessageMedia } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { buildFixtureSeeds } from './data'

const NOW = 1_760_000_000
/** The caller's fixture media: the seed says the fields, the fake supplies the bytes. */
const mediaOf = (fileId: number, extra: Partial<MessageMedia> = {}) => ({ fileId, ...extra })
const seeds = buildFixtureSeeds({ selfId: 1000, mediaOf, now: () => NOW })

describe('the fake account', () => {
  it('holds the conversations the UI is built against', () => {
    expect([...seeds.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 99])
    expect(seeds.get(99)?.messages).toHaveLength(5000)
  })

  it('keeps the album as two messages sharing one album id', () => {
    const album = seeds.get(1)?.messages.filter((message) => message.albumId === '7401') ?? []
    expect(album.map((message) => message.kind)).toEqual(['photo', 'video'])
  })

  it('carries one animated emoji message, with its click sound', () => {
    const message = seeds.get(2)?.messages.find((item) => item.id === 208)
    expect(message).toMatchObject({
      kind: 'emoji',
      text: '✨',
      media: { fileId: 7003, stickerFormat: 'tgs', soundFileId: 7004 },
    })
  })

  it('carries comment counts on the posts and the threads beside them', () => {
    const group = seeds.get(2)
    const post = group?.messages.find((message) => message.id === 203)
    expect(group?.comments?.[203]).toHaveLength(7)
    expect(post?.interaction).toEqual({ comments: 7, canOpen: true })

    const channel = seeds.get(5)
    expect(channel?.messages.find((m) => m.id === 502)?.interaction).toMatchObject({
      comments: 78,
      views: 12_400,
      forwards: 96,
    })
    expect(channel?.commentAccess).toEqual({ joined: false, canComment: false })
  })

  it('stores phones the way TDLib hands them over', () => {
    const phones = [...seeds.values()]
      .map((seed) => seed.contact?.phone)
      .filter((phone): phone is string => phone !== undefined)
    expect(phones.length).toBeGreaterThan(0)
    for (const phone of phones) expect(phone).toMatch(/^[0-9]+$/)
  })

  it('never dates a message in the future', () => {
    const dates = [...seeds.values()].flatMap((seed) => seed.messages.map((m) => m.date))
    expect(Math.max(...dates)).toBeLessThanOrEqual(NOW)
    for (const seed of seeds.values()) {
      expect(seed.chat.lastMessageAt).toBeLessThanOrEqual(NOW)
    }
  })

  it('starts every transcript at or below its newest chat stamp', () => {
    for (const seed of seeds.values()) {
      const newest = Math.max(...seed.messages.map((message) => message.date))
      expect(seed.chat.lastMessageAt).toBeGreaterThanOrEqual(newest)
    }
  })
})
