import type { ChatSummary, ConnectionState } from '@wechatgram/protocol'

import type { TdObject } from '../client'
import { previewContent } from './content'
import type { MapperContext } from './context'

export function mapChat(ctx: MapperContext, chat: TdObject): ChatSummary {
  const positions: TdObject[] = Array.isArray(chat.positions) ? chat.positions : []
  const mainPosition = positions.find((position) => position.list?._ === 'chatListMain')
  const lastMessage = chat.last_message
  if (typeof chat.title === 'string') ctx.chatTitles.set(chat.id, chat.title)
  const avatarUrl = ctx.chatAvatarUrls.get(chat.id)
  return {
    id: chat.id,
    title: chat.title ?? '',
    kind: mapChatKind(chat.type),
    unread: chat.unread_count ?? 0,
    pinned: Boolean(mainPosition?.is_pinned),
    muted: Boolean(chat.notification_settings?.is_muted),
    lastReadInboxMessageId: Number(chat.last_read_inbox_message_id ?? 0),
    lastReadOutboxMessageId: Number(chat.last_read_outbox_message_id ?? 0),
    ...(lastMessage ? { lastMessageText: previewContent(lastMessage.content) } : {}),
    ...(lastMessage ? { lastMessageAt: Number(lastMessage.date) } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  }
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
