import type { ChatMember, ChatSummary } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { personTiles } from './chatInfo'

const chat: ChatSummary = {
  id: 7,
  title: '某某群',
  kind: 'group',
  unread: 0,
  pinned: false,
  muted: false,
}

const member: ChatMember = { userId: 42, title: '小王' }

describe('personTiles', () => {
  it('draws the members a group returned, in order', () => {
    const tiles = personTiles([member, { userId: 43, title: '小李' }], chat)
    expect(tiles.map((tile) => tile.id)).toEqual([42, 43])
    expect(tiles[1]?.title).toBe('小李')
  })

  it('falls back to the conversation itself when there is no member list', () => {
    expect(personTiles([], chat)).toEqual([{ id: 7, title: '某某群' }])
  })

  it('keys the fallback of a private chat on the peer, so its colour is theirs', () => {
    const privateChat: ChatSummary = { ...chat, id: 11, userId: 99, kind: 'private' }
    expect(personTiles([], privateChat)[0]?.id).toBe(99)
  })

  it('carries the photo it already has', () => {
    const photo = personTiles([{ ...member, avatarUrl: 'wx-media://f/a' }], chat)
    expect(photo[0]?.avatarUrl).toBe('wx-media://f/a')
  })
})
