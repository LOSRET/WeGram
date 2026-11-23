import { describe, expect, it } from 'vitest'

import { createMockNotifications } from './notifications'

describe('mock 消息通知', () => {
  it('starts every scope unmuted, audible, with previews', () => {
    expect(createMockNotifications().all()).toEqual({
      private: { muted: false, sound: true, showPreview: true },
      group: { muted: false, sound: true, showPreview: true },
      channel: { muted: false, sound: true, showPreview: true },
    })
  })

  it('writes one scope without touching the others', () => {
    const notifications = createMockNotifications()
    notifications.set('group', { muted: true, sound: false, showPreview: false })
    const state = notifications.all()
    expect(state.group).toEqual({ muted: true, sound: false, showPreview: false })
    expect(state.private).toEqual({ muted: false, sound: true, showPreview: true })
    expect(state.channel).toEqual({ muted: false, sound: true, showPreview: true })
  })

  it('answers copies, so a caller cannot mutate the stored state', () => {
    const notifications = createMockNotifications()
    const state = notifications.all()
    state.private.muted = true
    expect(notifications.all().private.muted).toBe(false)
  })
})
