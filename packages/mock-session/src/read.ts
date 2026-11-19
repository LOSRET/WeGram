export interface ReadState {
  lastReadInboxMessageId: number
  unread: number
}

/**
 * Where the read marker lands and what is left unread.
 *
 * Telegram's marker is monotonic and `unread` is whatever incoming message is
 * newer than it, so a replayed or out-of-order report cannot un-read a chat.
 * `null` means "nothing to record": no marker and no messages.
 */
export function nextReadState(
  chat: { lastReadInboxMessageId?: number },
  messages: readonly { id: number; outgoing: boolean }[],
  upTo?: number,
): ReadState | null {
  const marker = upTo ?? messages.at(-1)?.id
  if (marker === undefined) return null
  const lastReadInboxMessageId = Math.max(chat.lastReadInboxMessageId ?? 0, marker)
  const unread = messages.filter(
    (message) => !message.outgoing && message.id > lastReadInboxMessageId,
  ).length
  return { lastReadInboxMessageId, unread }
}
