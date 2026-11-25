import { describe, expect, it } from 'vitest'

import { forwardedOrigin, type ForwardableRow } from './forward'

const row = (patch: Partial<ForwardableRow> = {}): ForwardableRow => ({
  senderId: 0,
  senderName: '未知',
  date: 100,
  ...patch,
})

describe('forwardedOrigin', () => {
  it('names the person a forwarded message came from', () => {
    expect(forwardedOrigin(row({ senderId: 42, senderName: '妈' }))).toEqual({
      fromName: '妈',
      fromUserId: 42,
      date: 100,
    })
  })

  it('names the chat for a channel post', () => {
    expect(
      forwardedOrigin(row({ senderId: 0, senderChatId: 55, senderName: 'WeGram 频道' })),
    ).toEqual({ fromName: 'WeGram 频道', fromChatId: 55, date: 100 })
  })

  it("keeps a forwarded message's original origin instead of the forwarder", () => {
    const origin = { fromName: 'Telegram News', fromChatId: 5, fromMessageId: 501, date: 90 }
    expect(forwardedOrigin(row({ senderId: 42, senderName: '妈', forward: origin }))).toEqual(
      origin,
    )
  })
})
