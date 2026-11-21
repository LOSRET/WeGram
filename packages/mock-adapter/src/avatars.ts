import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { UserAvatar } from '@wegram/protocol'

import type { AdapterEvent } from '@wegram/adapter-contract'
import { ME, MOCK_AVATAR_COLORS, type Fixture } from './constants'
import { createGradientPng } from './mock-assets'

/**
 * Generated profile photos for the fixtures (and the one sender whose photo
 * arrives late), so transcript rows show faces through the real image path
 * instead of staying on initials.
 */
export class MockAvatars {
  /** Sender id → generated photo. */
  readonly urls = new Map<number, string>()

  private lateId: number | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly deps: {
      mediaDir: string
      registerMedia: (path: string) => string
      fixtures: Map<number, Fixture>
      emit: (event: AdapterEvent) => void
    },
  ) {}

  /**
   * Every fixture chat gets a generated photo, so the list exercises <img>;
   * every fixture sender gets one too, so the transcript does not stay on
   * initials. One sender is left without a photo on purpose — its `evt:avatars`
   * arrives after login, which is the path the real adapter needs for photos
   * that finish downloading after a page was mapped.
   */
  attach(): void {
    for (const [chatId, fixture] of this.deps.fixtures) {
      const pair = MOCK_AVATAR_COLORS[chatId % MOCK_AVATAR_COLORS.length] ?? MOCK_AVATAR_COLORS[0]!
      const [from, to] = pair
      const path = join(this.deps.mediaDir, `chat-avatar-${chatId}.png`)
      writeFileSync(path, createGradientPng(128, 128, from, to))
      fixture.chat.avatarUrl = this.deps.registerMedia(path)
    }

    const senderIds = new Set<number>()
    for (const fixture of this.deps.fixtures.values()) {
      for (const message of fixture.messages) {
        if (message.senderId > 0 && message.senderId !== ME.id) senderIds.add(message.senderId)
      }
    }
    this.urls.clear()
    this.lateId = null
    for (const userId of [...senderIds].sort((a, b) => a - b)) {
      const pair =
        MOCK_AVATAR_COLORS[(userId + 2) % MOCK_AVATAR_COLORS.length] ?? MOCK_AVATAR_COLORS[0]!
      const [from, to] = pair
      const path = join(this.deps.mediaDir, `user-avatar-${userId}.png`)
      writeFileSync(path, createGradientPng(128, 128, from, to))
      this.urls.set(userId, this.deps.registerMedia(path))
      if (this.lateId === null) this.lateId = userId
      else this.stamp(userId)
    }
  }

  /** Copies a known photo onto every fixture row of one sender. */
  stamp(userId: number): void {
    const url = this.urls.get(userId)
    if (!url) return
    for (const fixture of this.deps.fixtures.values()) {
      for (const message of fixture.messages) {
        if (message.senderId === userId) message.senderAvatarUrl = url
      }
    }
  }

  /** Delivers the deferred sender photo the way the real cache does: an event. */
  schedule(): void {
    const userId = this.lateId
    if (userId === null || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const url = this.urls.get(userId)
      if (!url) return
      this.stamp(userId)
      const avatars: UserAvatar[] = [{ userId, url }]
      this.deps.emit({ type: 'avatars', avatars })
    }, 1_500)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
