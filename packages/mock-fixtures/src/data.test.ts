import type { MessageMedia } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { buildFixtureSeeds } from './data'

const NOW = 1_760_000_000
/** The caller's fixture media: the seed says the fields, the fake supplies the bytes. */
const mediaOf = (fileId: number, extra: Partial<MessageMedia> = {}) => ({ fileId, ...extra })
const seeds = buildFixtureSeeds({ selfId: 1000, mediaOf, now: () => NOW })

describe('the fake account', () => {
  it('holds the conversations the UI is built against', () => {
    expect([...seeds.keys()].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 99,
    ])
    expect(seeds.get(99)?.messages).toHaveLength(5000)
  })

  it('carries a forum whose messages all name their topic', () => {
    const forum = seeds.get(12)
    expect(forum?.chat.forum).toBe(true)
    expect(forum?.topics?.map((topic) => topic.id)).toEqual([1, 11, 12])
    expect(forum?.topics?.some((topic) => topic.isGeneral)).toBe(true)
    expect(forum?.topics?.some((topic) => topic.isClosed)).toBe(true)
    expect(forum?.messages.every((message) => typeof message.topicId === 'number')).toBe(true)
  })

  it('keeps the album as two messages sharing one album id', () => {
    const album = seeds.get(1)?.messages.filter((message) => message.albumId === '7401') ?? []
    expect(album.map((message) => message.kind)).toEqual(['photo', 'video'])
  })

  it('carries the two centered service rows the transcript draws', () => {
    const rows = seeds.get(3)?.messages.filter((message) => message.kind === 'service') ?? []
    expect(rows.map((message) => message.text)).toEqual(['未接听语音通话', '妈发送的图片已过期'])
  })

  it('carries one animated emoji message, with its click sound', () => {
    const message = seeds.get(2)?.messages.find((item) => item.id === 208)
    expect(message).toMatchObject({
      kind: 'emoji',
      text: '✨',
      media: { fileId: 7003, stickerFormat: 'tgs', soundFileId: 7004 },
    })
  })

  it('carries one premium sticker message, with its effect file', () => {
    const message = seeds.get(2)?.messages.find((item) => item.id === 207)
    expect(message).toMatchObject({
      kind: 'sticker',
      media: { fileId: 7003, premiumEffectFileId: 7005 },
    })
  })

  it('carries both mention kinds the transcript can jump from', () => {
    const message = seeds.get(4)?.messages.find((item) => item.id === 402)
    expect(message?.text.slice(1, 13)).toBe('ada_lovelace')
    expect(message?.entities).toEqual([
      { type: 'mention', offset: 0, length: 13 },
      { type: 'mentionName', offset: 16, length: 2, userId: 23 },
    ])
  })

  it('carries a t.me link the transcript opens inside the app', () => {
    const message = seeds.get(4)?.messages.find((item) => item.id === 403)
    expect(message?.text.slice(8)).toBe('https://t.me/ada_lovelace')
    expect(message?.entities).toEqual([{ type: 'url', offset: 8, length: 25 }])
  })

  it('carries one custom emoji entity, with its base glyph still in the text', () => {
    const message = seeds.get(2)?.messages.find((item) => item.id === 204)
    const text = message?.text ?? ''
    expect(text.endsWith('✨')).toBe(true)
    expect(message?.entities).toEqual([
      { type: 'customEmoji', offset: text.length - 1, length: 1, customEmojiId: '7003' },
    ])
  })

  it('carries comment data on a channel post and on group rows the UI must not draw', () => {
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
