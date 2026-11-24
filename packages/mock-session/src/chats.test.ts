import { describe, expect, it } from 'vitest'

import {
  applyChatCleared,
  canFakeGetMembers,
  canFakePost,
  chatPinKey,
  fakeJoinState,
  listedChatMembers,
  pinnedMessageFrom,
} from './chats'

const message = (
  senderId: number,
  senderName: string,
  overrides: { outgoing?: boolean; senderAvatarUrl?: string } = {},
) => ({
  outgoing: overrides.outgoing ?? false,
  senderId,
  senderName,
  ...(overrides.senderAvatarUrl ? { senderAvatarUrl: overrides.senderAvatarUrl } : {}),
})

describe('listedChatMembers', () => {
  it('answers the people who posted, once each, with their photo', () => {
    const members = listedChatMembers(
      [
        message(7, 'Ada', { senderAvatarUrl: 'wx-media://f/a' }),
        message(7, 'Ada'),
        message(8, 'Bob'),
        message(1, 'me', { outgoing: true }),
        message(0, 'nobody'),
      ],
      { limit: 10, isPrivate: false },
    )
    expect(members).toEqual([
      { userId: 7, title: 'Ada', avatarUrl: 'wx-media://f/a' },
      { userId: 8, title: 'Bob' },
    ])
  })

  it('filters by 搜索群成员 and stops at the limit', () => {
    const rows = [message(1, 'Ada'), message(2, 'Adam'), message(3, 'Bob')]
    expect(listedChatMembers(rows, { limit: 10, query: 'ada', isPrivate: false })).toHaveLength(2)
    expect(listedChatMembers(rows, { limit: 1, isPrivate: false })).toHaveLength(1)
  })

  it('answers nothing for a private chat', () => {
    expect(listedChatMembers([message(1, 'Ada')], { limit: 10, isPrivate: true })).toEqual([])
  })
})

describe('channel rights', () => {
  it('only a channel gates posting on the right', () => {
    expect(canFakePost({ kind: 'channel' }, false)).toBe(false)
    expect(canFakePost({ kind: 'channel' }, true)).toBe(true)
    expect(canFakePost({ kind: 'group' }, false)).toBe(true)
    expect(canFakePost({ kind: 'private' }, undefined)).toBe(true)
  })

  it('a channel member grid needs the administrator right; a group has one', () => {
    expect(canFakeGetMembers({ kind: 'channel' }, true)).toBe(true)
    expect(canFakeGetMembers({ kind: 'channel' }, undefined)).toBe(false)
    expect(canFakeGetMembers({ kind: 'group' }, undefined)).toBe(true)
    expect(canFakeGetMembers({ kind: 'private' }, true)).toBe(false)
  })

  it('a previewed channel is unjoined until it joins; nothing else asks', () => {
    expect(fakeJoinState({ kind: 'channel' }, false)).toEqual({ joined: false, byRequest: false })
    expect(fakeJoinState({ kind: 'channel' }, undefined)).toEqual({ joined: true, byRequest: false })
    expect(fakeJoinState({ kind: 'group' }, false)).toEqual({ joined: true, byRequest: false })
  })
})

describe('applyChatCleared', () => {
  it('drops the preview and the counter but keeps the row', () => {
    const chat: { unread: number; lastMessageText?: string; lastMessageAt?: number } = {
      unread: 3,
      lastMessageText: 'hi',
      lastMessageAt: 10,
    }
    applyChatCleared(chat)
    expect(chat).toEqual({ unread: 0 })
  })
})

describe('pins', () => {
  it('keys a chat and each of its topics apart', () => {
    expect(chatPinKey(12, undefined)).toBe('12')
    expect(chatPinKey(12, 7)).toBe('12:7')
  })

  it('labels a textless pinned row by its kind, like TDLib', () => {
    expect(pinnedMessageFrom({ text: 'hi', kind: 'text' }, 3)).toEqual({
      messageId: 3,
      text: 'hi',
    })
    expect(pinnedMessageFrom({ text: '', kind: 'photo' }, 3)).toEqual({
      messageId: 3,
      text: '[photo]',
    })
    expect(pinnedMessageFrom(undefined, 3)).toEqual({ messageId: 3, text: '[消息]' })
  })
})
