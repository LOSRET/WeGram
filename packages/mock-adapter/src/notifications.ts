import type {
  NotificationScope,
  NotificationScopes,
  ScopeNotificationSettings,
} from '@wegram/protocol'

/**
 * 消息通知 in the fake adapter: the same three switches per scope, kept in memory.
 *
 * Nothing is persisted between runs on purpose — the fixture account has no server
 * to sync with, and a demo that remembered last week's 免打扰 would pretend the
 * real client works that way.
 */

export const MOCK_SCOPE_DEFAULTS: ScopeNotificationSettings = {
  muted: false,
  sound: true,
  showPreview: true,
}

export function createMockNotifications() {
  const scopes: NotificationScopes = {
    private: { ...MOCK_SCOPE_DEFAULTS },
    group: { ...MOCK_SCOPE_DEFAULTS },
    channel: { ...MOCK_SCOPE_DEFAULTS },
  }

  return {
    /** Copies, because the caller holds what it got and must not alias this state. */
    all: (): NotificationScopes => ({
      private: { ...scopes.private },
      group: { ...scopes.group },
      channel: { ...scopes.channel },
    }),
    set: (scope: NotificationScope, settings: ScopeNotificationSettings): void => {
      scopes[scope] = { ...settings }
    },
  }
}

export type MockNotifications = ReturnType<typeof createMockNotifications>
