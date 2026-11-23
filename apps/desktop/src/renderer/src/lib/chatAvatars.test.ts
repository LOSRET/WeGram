import type { ChatSummary } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { missingAvatarIds } from './chatAvatars'

function chat(id: number, avatarUrl?: string): ChatSummary {
  return {
    id,
    title: `chat ${id}`,
    kind: 'private',
    unread: 0,
    pinned: false,
    muted: false,
    ...(avatarUrl ? { avatarUrl } : {}),
  }
}

describe('missingAvatarIds (可见区头像预取)', () => {
  it('asks only for the rows that have no photo yet', () => {
    const chats = [chat(1), chat(2, 'wx-media://f/a'), chat(3)]
    expect(missingAvatarIds(chats, 0, 2, new Set())).toEqual([1, 3])
  })

  it('skips what this session already asked for', () => {
    const chats = [chat(1), chat(2), chat(3)]
    expect(missingAvatarIds(chats, 0, 2, new Set([1, 2]))).toEqual([3])
  })

  it('clamps a window that runs past either end', () => {
    const chats = [chat(1), chat(2)]
    expect(missingAvatarIds(chats, -5, 1, new Set())).toEqual([1, 2])
    expect(missingAvatarIds(chats, 1, 99, new Set())).toEqual([2])
    expect(missingAvatarIds(chats, 5, 9, new Set())).toEqual([])
  })
})
