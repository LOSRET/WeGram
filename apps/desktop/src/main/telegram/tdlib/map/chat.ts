import type { BootState, ChatSummary, ConnectionState } from '@wegram/protocol'

import type { TdObject } from '../client'
import { previewContent, previewSpoilers } from './content'
import type { MapperContext } from './context'
import { chatPlacement } from './placement'

export function mapChat(ctx: MapperContext, chat: TdObject): ChatSummary {
  const placement = chatPlacement(chat)
  const lastMessage = chat.last_message
  // 0 means "nothing read yet", not message 0: the unread divider must then fall
  // back to the unread counter instead of being pinned above the first row of the
  // loaded page (findUnreadMessage treats null as "no marker").
  const lastReadInbox = Number(chat.last_read_inbox_message_id ?? 0)
  if (typeof chat.title === 'string') ctx.chatTitles.set(chat.id, chat.title)
  const avatarUrl = ctx.chatAvatarUrls.get(chat.id)
  const lastSpoilers = lastMessage ? previewSpoilers(lastMessage.content) : []
  // The 通讯录 hides our own Saved Messages by comparing this with `Self.id`.
  // TDLib always sends it for private/secret chats, but a partial object must not
  // leak NaN into a DTO the zod boundary validates.
  const peerUserId =
    chat.type?._ === 'chatTypePrivate' || chat.type?._ === 'chatTypeSecret'
      ? Number(chat.type.user_id)
      : Number.NaN
  return {
    id: chat.id,
    title: chat.title ?? '',
    kind: mapChatKind(chat.type),
    ...(Number.isFinite(peerUserId) && peerUserId > 0 ? { userId: peerUserId } : {}),
    unread: chat.unread_count ?? 0,
    pinned: placement.pinned,
    muted: isMuted(chat.notification_settings),
    archived: placement.archived,
    ...(lastReadInbox > 0 ? { lastReadInboxMessageId: lastReadInbox } : {}),
    lastReadOutboxMessageId: Number(chat.last_read_outbox_message_id ?? 0),
    ...(lastMessage ? { lastMessageText: previewContent(lastMessage.content) } : {}),
    ...(lastSpoilers.length > 0 ? { lastMessageSpoilers: lastSpoilers } : {}),
    ...(lastMessage ? { lastMessageAt: Number(lastMessage.date) } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  }
}

/**
 * `chatNotificationSettings` carries no `is_muted`: TDLib stores a countdown
 * (`mute_for`, seconds left) and `use_default_mute_for` says the scope default
 * applies instead. The scope default is not fetched here (it would cost one call
 * per row); a chat muted through this client always writes its own `mute_for`.
 */
function isMuted(settings: TdObject | undefined): boolean {
  if (!settings || settings.use_default_mute_for) return false
  return Number(settings.mute_for ?? 0) > 0
}

export function mapChatKind(type: TdObject | undefined): ChatSummary['kind'] {
  switch (type?._) {
    case 'chatTypePrivate':
      return 'private'
    case 'chatTypeSecret':
      return 'private'
    case 'chatTypeSupergroup':
      return type.is_channel ? 'channel' : 'group'
    default:
      return 'group'
  }
}

export function mapConnectionState(state: TdObject | undefined): ConnectionState {
  switch (state?._) {
    case 'connectionStateReady':
      return 'online'
    case 'connectionStateUpdating':
      return 'updating'
    case 'connectionStateConnecting':
    case 'connectionStateConnectingToProxy':
      return 'connecting'
    default:
      return 'offline'
  }
}

/**
 * The same update as a boot stage. It keeps the one detail `ConnectionState` has
 * no room for: whether the client is dialing through the configured proxy, which
 * is how the login window tells "connecting" from "the proxy is wrong".
 */
export function mapConnectionBoot(state: TdObject | undefined): BootState {
  switch (state?._) {
    case 'connectionStateReady':
      return { kind: 'ready' }
    case 'connectionStateUpdating':
      return { kind: 'updating' }
    case 'connectionStateWaitingForNetwork':
      return { kind: 'offline' }
    case 'connectionStateConnectingToProxy':
      return { kind: 'connecting', viaProxy: true }
    default:
      return { kind: 'connecting', viaProxy: false }
  }
}
