import type { Message } from '@wechatgram/protocol'

import type { UnreadMarker } from '../../store/useAppStore'

/**
 * Id of the first message the reader had not seen when opening the chat.
 *
 * The read marker is authoritative; the unread counter is only a fallback for
 * chats whose marker is missing (e.g. a brand-new session). Returns null when the
 * divider would not make sense.
 */
export function findUnreadMessage(messages: Message[], marker: UnreadMarker | null): number | null {
  if (!marker || marker.unread <= 0 || messages.length === 0) return null
  if (marker.lastReadInboxMessageId !== null) {
    const found = messages.find(
      (message) => !message.outgoing && message.id > marker.lastReadInboxMessageId!,
    )
    return found?.id ?? null
  }
  const fallback = messages[Math.max(0, messages.length - marker.unread)]
  return fallback?.id ?? null
}
