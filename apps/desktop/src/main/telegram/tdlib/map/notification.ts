import type { ScopeNotificationSettings } from '@wegram/protocol'

import type { TdObject } from '../client'

/**
 * TDLib's "muted forever": the official clients send 2^31-1 seconds (about 68
 * years) for 消息免打扰, because `mute_for` is a countdown, not a flag.
 */
export const MUTE_FOREVER_SECONDS = 2_147_483_647

/**
 * `scopeNotificationSettings` → the three switches 消息通知 draws (design doc
 * §9.11.3). Anything TDLib answers that has no switch is simply not read here —
 * `toScopeNotificationSettings` writes it back unchanged.
 */
export function mapScopeNotificationSettings(raw: TdObject): ScopeNotificationSettings {
  const muteFor = Number(raw.mute_for)
  const soundId: unknown = raw.sound_id
  return {
    muted: Number.isFinite(muteFor) && muteFor > 0,
    // TDLib: `0` disables the sound, `-1` means the app's default sound.
    sound: !(soundId === 0 || soundId === '0'),
    showPreview: raw.show_preview !== false,
  }
}

/**
 * The three switches → the full struct `setScopeNotificationSettings` wants.
 *
 * That method replaces the settings wholesale, so every field this client does not
 * show (stories, pinned messages, mentions) is copied from what TDLib last
 * answered. Dropping them would silently reset another device's preferences on
 * every toggle here.
 */
export function toScopeNotificationSettings(
  current: TdObject,
  settings: ScopeNotificationSettings,
): TdObject {
  return {
    _: 'scopeNotificationSettings',
    mute_for: settings.muted ? MUTE_FOREVER_SECONDS : 0,
    sound_id: settings.sound ? '-1' : '0',
    show_preview: settings.showPreview,
    mute_stories: current.mute_stories === true,
    use_default_mute_stories: current.use_default_mute_stories !== false,
    story_sound_id: typeof current.story_sound_id === 'string' ? current.story_sound_id : '-1',
    show_story_poster: current.show_story_poster !== false,
    disable_pinned_message_notifications: current.disable_pinned_message_notifications === true,
    disable_mention_notifications: current.disable_mention_notifications === true,
  }
}
