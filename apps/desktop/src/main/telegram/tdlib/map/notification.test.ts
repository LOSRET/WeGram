import { describe, expect, it } from 'vitest'

import type { TdObject } from '../client'
import {
  MUTE_FOREVER_SECONDS,
  mapScopeNotificationSettings,
  toScopeNotificationSettings,
} from './notification'

function settings(overrides: Partial<TdObject> = {}): TdObject {
  return {
    _: 'scopeNotificationSettings',
    mute_for: 0,
    sound_id: '-1',
    show_preview: true,
    mute_stories: false,
    use_default_mute_stories: true,
    story_sound_id: '-1',
    show_story_poster: true,
    disable_pinned_message_notifications: false,
    disable_mention_notifications: false,
    ...overrides,
  }
}

describe('mapScopeNotificationSettings', () => {
  it('reads a default scope as unmuted, audible, with previews', () => {
    expect(mapScopeNotificationSettings(settings())).toEqual({
      muted: false,
      sound: true,
      showPreview: true,
    })
  })

  it('reads mute_for as the mute switch and sound_id 0 as "no sound"', () => {
    expect(
      mapScopeNotificationSettings(settings({ mute_for: MUTE_FOREVER_SECONDS, sound_id: '0' })),
    ).toEqual({ muted: true, sound: false, showPreview: true })
  })

  it('reads show_preview false', () => {
    expect(mapScopeNotificationSettings(settings({ show_preview: false })).showPreview).toBe(false)
  })
})

describe('toScopeNotificationSettings', () => {
  it('writes the three switches in TDLib vocabulary', () => {
    const raw = toScopeNotificationSettings(settings(), {
      muted: true,
      sound: false,
      showPreview: false,
    })
    expect(raw.mute_for).toBe(MUTE_FOREVER_SECONDS)
    expect(raw.sound_id).toBe('0')
    expect(raw.show_preview).toBe(false)
  })

  it('preserves the fields the panel does not draw', () => {
    const current = settings({
      mute_stories: true,
      show_story_poster: false,
      disable_mention_notifications: true,
      story_sound_id: '42',
    })
    const raw = toScopeNotificationSettings(current, {
      muted: false,
      sound: true,
      showPreview: true,
    })
    expect(raw.mute_stories).toBe(true)
    expect(raw.use_default_mute_stories).toBe(true)
    expect(raw.show_story_poster).toBe(false)
    expect(raw.disable_mention_notifications).toBe(true)
    expect(raw.story_sound_id).toBe('42')
  })
})
