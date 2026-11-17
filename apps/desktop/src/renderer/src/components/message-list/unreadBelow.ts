/**
 * What the "N 条新消息" pill should say.
 *
 * The pill, the chat row and the rail badge have to tell the same story, so the
 * count is derived from the source the badges come from: the read marker
 * (`chat.lastReadInboxMessageId`, which our own `messages:read` moves and the
 * server answers). "Still new" means **newer than the marker and still below the
 * viewport** — everything the reader has scrolled past has already moved the
 * marker, and messages the server counts as read (another device, the open-chat
 * snapshot) are not new any more.
 *
 * Deriving it instead of counting arrivals also removes a whole class of bugs:
 * a prepended history page, a burst that arrives while the first page is still
 * loading, or a relogin cannot inflate the number, because nothing accumulates.
 */
export interface UnreadMessage {
  readonly id: number
  readonly outgoing: boolean
}

/**
 * @param seenIndex Index of the newest message whose row has been on screen, or
 *   -1 before the first measurement. Everything after it is still below the fold.
 * @param readMarker `chat.lastReadInboxMessageId`; null when the server has not
 *   reported one yet (a fresh session), in which case nothing counts as read.
 */
export function countUnreadBelow(
  messages: readonly UnreadMessage[],
  readMarker: number | null,
  seenIndex: number,
): number {
  let count = 0
  for (let index = Math.max(seenIndex + 1, 0); index < messages.length; index += 1) {
    const message = messages[index]
    // Our own messages are never unread mail, and `chat.unread` does not count them.
    if (!message || message.outgoing) continue
    if (readMarker === null || message.id > readMarker) count += 1
  }
  return count
}
