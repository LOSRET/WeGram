import type { ChatSummary, Message } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { senderAvatarUrl } from './senderAvatar'
import type { SelfIdentity } from './senderAvatar'

const SELF: SelfIdentity = { id: 1000, name: '我', avatarUrl: 'wx-media://f/me' }
const CHAT: ChatSummary = {
  id: 2,
  title: '群',
  kind: 'group',
  unread: 0,
  pinned: false,
  muted: false,
  avatarUrl: 'wx-media://f/chat',
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    chatId: 2,
    senderId: 42,
    senderName: '成员',
    outgoing: false,
    date: 1_700_000_000,
    kind: 'text',
    text: 'hi',
    ...overrides,
  }
}

describe('senderAvatarUrl', () => {
  it('draws our own rows with the account photo', () => {
    expect(senderAvatarUrl(message({ outgoing: true, senderId: 1000 }), CHAT, SELF, {})).toBe(
      'wx-media://f/me',
    )
  })

  it('prefers the photo a row already carries', () => {
    expect(
      senderAvatarUrl(message({ senderAvatarUrl: 'wx-media://f/row' }), CHAT, SELF, {
        42: 'wx-media://f/late',
      }),
    ).toBe('wx-media://f/row')
  })

  it('falls back to the late evt:avatars batch', () => {
    expect(senderAvatarUrl(message(), CHAT, SELF, { 42: 'wx-media://f/late' })).toBe(
      'wx-media://f/late',
    )
  })

  it('draws initials until a photo is known', () => {
    expect(senderAvatarUrl(message(), CHAT, SELF, {})).toBeUndefined()
    expect(
      senderAvatarUrl(message({ outgoing: true }), CHAT, { ...SELF, avatarUrl: undefined }, {}),
    ).toBeUndefined()
  })

  it('draws a channel post with the live chat photo', () => {
    const post = message({ senderId: 0, senderChatId: 2, senderName: '频道' })

    // A photo that arrived after the page was mapped still reaches the row.
    expect(senderAvatarUrl(post, CHAT, SELF, {})).toBe('wx-media://f/chat')
    expect(senderAvatarUrl(post, { ...CHAT, avatarUrl: undefined }, SELF, {})).toBeUndefined()
  })

  it('keeps a linked channel photo from the row', () => {
    const post = message({
      senderId: 0,
      senderChatId: 77,
      senderName: '频道',
      senderAvatarUrl: 'wx-media://f/other',
    })
    expect(senderAvatarUrl(post, CHAT, SELF, {})).toBe('wx-media://f/other')
  })
})
