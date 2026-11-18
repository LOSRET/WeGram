import { describe, expect, it } from 'vitest'

import { mapChat, mapChatKind, mapConnectionState } from './chat'
import type { MapperContext } from './context'

function makeContext(overrides: Partial<MapperContext> = {}): MapperContext {
  return {
    chatTitles: new Map(),
    chatAvatarUrls: new Map(),
    userAvatarUrls: new Map(),
    stickerSizes: new Map(),
    resolveUserName: async (userId) => `user-${userId}`,
    resolveChatTitle: async (chatId) => `chat-${chatId}`,
    prefetchUserAvatars: () => undefined,
    ...overrides,
  }
}

describe('mapChat', () => {
  it('maps position, unread, notification and read markers', () => {
    const chat = mapChat(makeContext(), {
      id: 1,
      title: 'Team',
      type: { _: 'chatTypeSupergroup', is_channel: false },
      unread_count: 3,
      positions: [{ list: { _: 'chatListMain' }, is_pinned: true }],
      // TDLib has no `is_muted`: a chat mute is a countdown, and the scope
      // default only applies while `use_default_mute_for` is set.
      notification_settings: {
        _: 'chatNotificationSettings',
        use_default_mute_for: false,
        mute_for: 3600,
      },
      last_read_inbox_message_id: 10,
      last_read_outbox_message_id: 12,
      last_message: {
        id: 20,
        date: 1_700_000_000,
        content: { _: 'messageText', text: { text: 'last words' } },
      },
    })

    expect(chat).toEqual({
      id: 1,
      title: 'Team',
      kind: 'group',
      unread: 3,
      pinned: true,
      muted: true,
      lastReadInboxMessageId: 10,
      lastReadOutboxMessageId: 12,
      lastMessageText: 'last words',
      lastMessageAt: 1_700_000_000,
    })
  })

  it('treats a zero countdown and an inherited default as unmuted', () => {
    const open = mapChat(makeContext(), {
      id: 3,
      type: { _: 'chatTypeSupergroup', is_channel: false },
      notification_settings: {
        _: 'chatNotificationSettings',
        use_default_mute_for: false,
        mute_for: 0,
      },
    })
    const inherited = mapChat(makeContext(), {
      id: 4,
      type: { _: 'chatTypeSupergroup', is_channel: false },
      notification_settings: {
        _: 'chatNotificationSettings',
        use_default_mute_for: true,
        mute_for: 0,
      },
    })

    expect(open.muted).toBe(false)
    expect(inherited.muted).toBe(false)
  })

  it('remembers the title for later sender resolution', () => {
    const ctx = makeContext()
    mapChat(ctx, { id: 5, title: 'Remembered', type: { _: 'chatTypePrivate' } })

    expect(ctx.chatTitles.get(5)).toBe('Remembered')
  })

  it('attaches a downloaded avatar URL from the cache', () => {
    const ctx = makeContext({ chatAvatarUrls: new Map([[5, 'wx-media://f/abc']]) })
    const chat = mapChat(ctx, { id: 5, title: 'x', type: { _: 'chatTypePrivate' } })

    expect(chat.avatarUrl).toBe('wx-media://f/abc')
  })

  it('omits optional fields instead of writing null/undefined', () => {
    const chat = mapChat(makeContext(), { id: 2, type: { _: 'chatTypePrivate' } })

    expect(chat).not.toHaveProperty('lastMessageText')
    expect(chat).not.toHaveProperty('lastMessageAt')
    expect(chat).not.toHaveProperty('avatarUrl')
    // 0 is "nothing read yet", not message 0: the unread divider needs the null.
    expect(chat).not.toHaveProperty('lastReadInboxMessageId')
    expect(chat.unread).toBe(0)
    expect(chat.pinned).toBe(false)
    expect(chat.muted).toBe(false)
  })
})

describe('mapChatKind', () => {
  it('distinguishes private, group, channel and secret chats', () => {
    expect(mapChatKind({ _: 'chatTypePrivate' })).toBe('private')
    expect(mapChatKind({ _: 'chatTypeSecret' })).toBe('private')
    expect(mapChatKind({ _: 'chatTypeSupergroup', is_channel: false })).toBe('group')
    expect(mapChatKind({ _: 'chatTypeSupergroup', is_channel: true })).toBe('channel')
    expect(mapChatKind({ _: 'chatTypeBasicGroup' })).toBe('group')
    expect(mapChatKind(undefined)).toBe('group')
  })
})

describe('mapConnectionState', () => {
  it('maps every TDLib connection state', () => {
    expect(mapConnectionState({ _: 'connectionStateReady' })).toBe('online')
    expect(mapConnectionState({ _: 'connectionStateUpdating' })).toBe('updating')
    expect(mapConnectionState({ _: 'connectionStateConnecting' })).toBe('connecting')
    expect(mapConnectionState({ _: 'connectionStateConnectingToProxy' })).toBe('connecting')
    expect(mapConnectionState({ _: 'connectionStateWaitingForNetwork' })).toBe('offline')
    expect(mapConnectionState(undefined)).toBe('offline')
  })
})
