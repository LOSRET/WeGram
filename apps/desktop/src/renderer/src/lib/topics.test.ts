import { describe, expect, it } from 'vitest'

import type { ChatTopic } from '@wegram/protocol'

import { topicBadge, topicSwatch, topicUnreadMarker } from './topics'

function topic(overrides: Partial<ChatTopic> = {}): ChatTopic {
  return {
    id: 1,
    title: '综合',
    isGeneral: true,
    isClosed: false,
    isPinned: false,
    muted: false,
    iconColor: 0x6fb9f0,
    unread: 0,
    ...overrides,
  }
}

describe('topicSwatch', () => {
  it('turns TDLib\'s 0xRRGGBB into a CSS colour', () => {
    expect(topicSwatch(0x6fb9f0)).toBe('#6fb9f0')
    expect(topicSwatch(0x000001)).toBe('#000001')
  })

  it('falls back instead of painting #NaN for a value that is not a colour', () => {
    expect(topicSwatch(Number.NaN)).toBe('#6fb9f0')
    expect(topicSwatch(0)).toBe('#6fb9f0')
    expect(topicSwatch(0xffffff + 1)).toBe('#6fb9f0')
  })
})

describe('topicUnreadMarker', () => {
  it('is null when the topic has nothing unread', () => {
    expect(topicUnreadMarker(topic())).toBeNull()
    expect(topicUnreadMarker(null)).toBeNull()
  })

  it('carries the topic\'s own read boundary', () => {
    expect(topicUnreadMarker(topic({ unread: 3, lastReadInboxMessageId: 1201 }))).toEqual({
      lastReadInboxMessageId: 1201,
      unread: 3,
    })
  })

  it('leaves the boundary null when the server has not reported one', () => {
    expect(topicUnreadMarker(topic({ unread: 2 }))).toEqual({
      lastReadInboxMessageId: null,
      unread: 2,
    })
  })
})

describe('topicBadge', () => {
  it('draws no badge at zero', () => {
    expect(topicBadge(topic())).toBeNull()
    expect(topicBadge(topic({ unread: 4 }))).toBe(4)
  })
})