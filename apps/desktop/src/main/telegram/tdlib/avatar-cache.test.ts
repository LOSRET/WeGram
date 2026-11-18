import type { ChatOp, ChatSummary, UserAvatar } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { AvatarCache } from './avatar-cache'
import type { TdObject } from './client'

/** Wait for one flush window (120 ms) plus a little slack. */
const FLUSH = 200

function chatSummary(chatId: number): ChatSummary {
  return {
    id: chatId,
    title: `chat-${chatId}`,
    kind: 'group',
    unread: 0,
    pinned: false,
    muted: false,
    avatarUrl: `wx-media://f/${chatId}`,
  }
}

/**
 * Stand-in for the adapter: `photos` answers `getChat`/`getUser` (an empty
 * object means "this subject has no picture"), everything else is recorded.
 */
function makeCache(photos: Record<string, TdObject> = {}) {
  const calls: string[] = []
  const downloads: number[] = []
  const chatOps: ChatOp[] = []
  const avatars: UserAvatar[] = []

  const cache = new AvatarCache({
    invoke: async (method) => {
      const id = method._ === 'getChat' ? method.chat_id : method.user_id
      const key = `${String(method._)}:${String(id)}`
      calls.push(key)
      return photos[key] ?? {}
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    downloadFilePath: async (fileId) => {
      downloads.push(fileId)
      return { path: `C:/avatars/${fileId}.jpg` }
    },
    downloadFile: async (fileId) => ({ url: `wx-media://f/${fileId}` }),
    fetchChatSummary: async (chatId) => chatSummary(chatId),
    emitChats: (ops) => chatOps.push(...ops),
    emitAvatars: (items) => avatars.push(...items),
    onSelfAvatar: () => undefined,
  })

  return { cache, calls, downloads, chatOps, avatars }
}

describe('AvatarCache', () => {
  it('downloads chat and user photos into their own caches, once each', async () => {
    const { cache, calls, downloads, chatOps, avatars } = makeCache({
      'getChat:1': { id: 1, photo: { small: { id: 901 } } },
      'getUser:42': { id: 42, profile_photo: { small: { id: 902 } } },
    })

    cache.prefetch([1])
    cache.prefetchUsers([42, 42])
    // A second prefetch while the first download is queued must not duplicate it.
    cache.prefetchUsers([42])

    await new Promise((resolve) => setTimeout(resolve, FLUSH))

    expect(cache.urls.get(1)).toMatch(/^wx-media:\/\/f\//)
    expect(cache.userUrls.get(42)).toMatch(/^wx-media:\/\/f\//)
    expect(downloads).toEqual([901, 902])
    expect(calls).toEqual(['getChat:1', 'getUser:42'])
    expect(chatOps.map((op) => op.op)).toEqual(['upsert'])
    expect(avatars).toEqual([{ userId: 42, url: cache.userUrls.get(42) }])
  })

  it('remembers a subject without a photo and never asks again', async () => {
    const { cache, calls } = makeCache()

    cache.prefetchUsers([7])
    await new Promise((resolve) => setTimeout(resolve, FLUSH))
    cache.prefetchUsers([7])
    await new Promise((resolve) => setTimeout(resolve, FLUSH))

    expect(calls).toEqual(['getUser:7'])
    expect(cache.userUrls.has(7)).toBe(false)
  })

  it('refetches a user photo only when the file id changed', async () => {
    const { cache, calls } = makeCache({
      'getUser:5': { id: 5, profile_photo: { small: { id: 700 } } },
    })

    cache.prefetchUsers([5])
    await new Promise((resolve) => setTimeout(resolve, FLUSH))

    // Same picture reported again by `updateUser` (a name change): nothing to do.
    cache.syncUserPhoto(5, 700)
    await new Promise((resolve) => setTimeout(resolve, FLUSH))
    expect(calls).toEqual(['getUser:5'])

    // A new picture replaces the cached one.
    cache.syncUserPhoto(5, 701)
    expect(cache.userUrls.has(5)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, FLUSH))
    expect(calls).toEqual(['getUser:5', 'getUser:5'])
    expect(cache.userUrls.has(5)).toBe(true)
  })

  it('drops a photo that was removed', async () => {
    const { cache } = makeCache({
      'getUser:5': { id: 5, profile_photo: { small: { id: 700 } } },
    })

    cache.prefetchUsers([5])
    await new Promise((resolve) => setTimeout(resolve, FLUSH))
    expect(cache.userUrls.has(5)).toBe(true)

    cache.syncUserPhoto(5, undefined)
    expect(cache.userUrls.has(5)).toBe(false)
  })
})
