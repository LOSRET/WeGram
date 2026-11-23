import type { ChatTopic } from '@wegram/protocol'

import type { TdObject } from '../client'
import { isMuted } from './chat'
import { previewContent, previewSpoilers } from './content'

/**
 * 话题 row (design doc §9.12), from TDLib's `forumTopic`.
 *
 * The row carries exactly what the list draws — icon, name, the last message's
 * preview and date, the unread counter and the read marker the unread divider
 * inside the topic is built from. Anything else (drafts, per-topic muting) stays
 * in TDLib until a later batch needs it.
 */
export function mapTopic(raw: TdObject): ChatTopic {
  const info: TdObject = raw.info ?? {}
  const lastMessage: TdObject | undefined = raw.last_message ?? undefined
  const color = Number(info.icon?.color ?? 0)
  const emojiId = String(info.icon?.custom_emoji_id ?? '0')
  const lastReadInbox = Number(raw.last_read_inbox_message_id ?? 0)
  const lastReadOutbox = Number(raw.last_read_outbox_message_id ?? 0)
  const spoilers = lastMessage ? previewSpoilers(lastMessage.content) : []
  return {
    id: Number(info.forum_topic_id ?? 0),
    title: typeof info.name === 'string' ? info.name : '',
    isGeneral: info.is_general === true,
    isClosed: info.is_closed === true,
    // 免打扰 is the topic's own notification settings; a topic muted with the
    // countdown expired reads as unmuted, exactly like a chat.
    muted: isMuted(raw.notification_settings),
    isPinned: raw.is_pinned === true,
    iconColor: Number.isFinite(color) ? color : 0,
    ...(emojiId !== '0' && emojiId !== '' ? { iconEmojiId: emojiId } : {}),
    unread: Number(raw.unread_count ?? 0),
    ...(lastReadInbox > 0 ? { lastReadInboxMessageId: lastReadInbox } : {}),
    ...(lastReadOutbox > 0 ? { lastReadOutboxMessageId: lastReadOutbox } : {}),
    ...(lastMessage ? { lastMessageId: Number(lastMessage.id) } : {}),
    ...(lastMessage ? { lastMessageText: previewContent(lastMessage.content) } : {}),
    ...(spoilers.length > 0 ? { lastMessageSpoilers: spoilers } : {}),
    ...(lastMessage ? { lastMessageAt: Number(lastMessage.date) } : {}),
  }
}

/**
 * The same row from a bare `forumTopicInfo` (what `createForumTopic` answers and
 * what `updateForumTopicInfo` carries): no last message and no unread state.
 */
export function mapTopicInfo(info: TdObject): ChatTopic {
  return mapTopic({ info, is_pinned: false, unread_count: 0 })
}
