import type {
  NotificationScope,
  NotificationScopes,
  ScopeNotificationSettings,
} from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapScopeNotificationSettings, toScopeNotificationSettings } from '../map/notification'
import type { ActionDeps } from './deps'

/**
 * 消息通知's scope defaults (design doc §9.11.3).
 *
 * TDLib keeps one scopeNotificationSettings per chat kind and applies it to every
 * chat whose own chatNotificationSettings is not overridden, which is exactly the
 * "default for new conversations" the settings group means.
 */

const SCOPES: Record<NotificationScope, TdObject> = {
  private: { _: 'notificationSettingsScopePrivateChats' },
  group: { _: 'notificationSettingsScopeGroupChats' },
  channel: { _: 'notificationSettingsScopeChannelChats' },
}

async function readScope(deps: ActionDeps, scope: NotificationScope): Promise<TdObject> {
  return deps.invoke({ _: 'getScopeNotificationSettings', scope: SCOPES[scope] })
}

/** All three scopes, read together so the panel paints one consistent state. */
export async function notificationScopes(deps: ActionDeps): Promise<NotificationScopes> {
  const [privateChats, groups, channels] = await Promise.all([
    readScope(deps, 'private'),
    readScope(deps, 'group'),
    readScope(deps, 'channel'),
  ])
  return {
    private: mapScopeNotificationSettings(privateChats),
    group: mapScopeNotificationSettings(groups),
    channel: mapScopeNotificationSettings(channels),
  }
}

export async function setNotificationScope(
  deps: ActionDeps,
  scope: NotificationScope,
  settings: ScopeNotificationSettings,
): Promise<void> {
  // Read first: setScopeNotificationSettings replaces the whole struct, and the
  // story/mention fields the panel does not draw must survive the write.
  const current = await readScope(deps, scope)
  await deps.invoke({
    _: 'setScopeNotificationSettings',
    scope: SCOPES[scope],
    notification_settings: toScopeNotificationSettings(current, settings),
  })
}
