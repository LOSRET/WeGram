import { z } from 'zod'

/**
 * 消息通知 (design doc §9.11.3), the first group of batch B.
 *
 * TDLib keeps the defaults per *scope* — private chats, groups and channels — and
 * applies them to every chat whose own settings do not override them. That is why
 * these values live on the account and not in `ui.db`: a second device must show
 * the same answer, exactly like the official client.
 *
 * The one exception is 桌面通知 itself: whether this machine pops a toast is a
 * property of this installation, not of the account, so it stays local (§9.11.3's
 * 归属规则) and is stored in `ui.db`.
 */

/** The three scopes TDLib's `notificationSettingsScope*` methods partition chats into. */
export const notificationScopeSchema = z.enum(['private', 'group', 'channel'])
export type NotificationScope = z.infer<typeof notificationScopeSchema>

/**
 * The three switches 消息通知 draws for one scope. Stories, pinned-message and
 * mention rules also live in TDLib's `scopeNotificationSettings`, but WeGram has no
 * UI for them; the adapter writes them back unchanged instead of exposing knobs
 * nobody asked for (see `toScopeNotificationSettings`).
 */
export const scopeNotificationSettingsSchema = z.object({
  /** 消息免打扰: notifications for this scope are muted (TDLib's `mute_for > 0`). */
  muted: z.boolean(),
  /** 提示音: TDLib's `sound_id != '0'`. */
  sound: z.boolean(),
  /** 显示消息内容: TDLib's `show_preview`. */
  showPreview: z.boolean(),
})
export type ScopeNotificationSettings = z.infer<typeof scopeNotificationSettingsSchema>

/** One settings triple per scope; the panel paints all three from one read. */
export const notificationScopesSchema = z.object({
  private: scopeNotificationSettingsSchema,
  group: scopeNotificationSettingsSchema,
  channel: scopeNotificationSettingsSchema,
})
export type NotificationScopes = z.infer<typeof notificationScopesSchema>

/** What 消息通知 reads: the local desktop switch plus the account's scope defaults. */
export const notificationsStateSchema = z.object({
  /** 桌面通知: this installation shows OS toasts at all. Local (`ui.db`). */
  desktop: z.boolean(),
  scopes: notificationScopesSchema,
})
export type NotificationsState = z.infer<typeof notificationsStateSchema>

/**
 * The notification channels, in their own table like `network.ts`.
 *
 * `notifications:setScope` takes the whole triple for one scope rather than a patch:
 * the panel already holds the state it read, and a full object makes the written
 * value identical to what the switch shows. The adapter reads TDLib's current
 * struct first, because `setScopeNotificationSettings` replaces it wholesale.
 */
export const notificationInvokeChannels = [
  'notifications:get',
  'notifications:setScope',
  'notifications:setDesktop',
] as const

export const notificationInvokeSchemas = {
  'notifications:get': { request: z.void(), response: notificationsStateSchema },
  'notifications:setScope': {
    request: z.object({
      scope: notificationScopeSchema,
      settings: scopeNotificationSettingsSchema,
    }),
    response: z.void(),
  },
  'notifications:setDesktop': {
    request: z.object({ desktop: z.boolean() }),
    response: z.void(),
  },
}
