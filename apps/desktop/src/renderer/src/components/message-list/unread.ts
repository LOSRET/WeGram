import type { Message } from '@wegram/protocol'

/**
 * What the chat looked like when it was opened: the read boundary and the unread
 * counter, captured by `MainShell` *before* the read marker can move (opening no
 * longer marks the chat read; the list reports what it shows, a few hundred
 * milliseconds after it mounts).
 *
 * Structurally identical to the store's `UnreadMarker`, declared here so this module
 * stays free of store imports (it is pure and unit-tested).
 */
export interface UnreadBoundary {
  lastReadInboxMessageId: number | null
  unread: number
}

/**
 * Where the transcript sits on its first paint.
 *
 * `anchor` — a saved reading position (row top at `offset` from the viewport top).
 * `unread` — the "以下是新消息" line is aligned to the viewport top, so everything
 * below it is new. `null` (no landing) means the newest message.
 */
export type LandingPosition =
  { kind: 'anchor'; messageId: number; offset: number } | { kind: 'unread'; messageId: number }

/** The message id the first page has to reach back to before the list may mount. */
export interface PagingTarget {
  /**
   * `locate` is 定位到聊天位置 from the viewer: the chat opens on a row the reader
   * asked for, which outranks both the saved position and the unread divider.
   */
  kind: 'anchor' | 'unread' | 'locate'
  messageId: number
}

/**
 * Id of the first message the reader had not seen when opening the chat.
 *
 * The read marker is authoritative; the unread counter is only a fallback for
 * chats whose marker is missing (e.g. a brand-new session). Returns null when the
 * divider would not make sense.
 */
export function findUnreadMessage(
  messages: Message[],
  marker: UnreadBoundary | null,
): number | null {
  if (!marker || marker.unread <= 0 || messages.length === 0) return null
  const boundary = marker.lastReadInboxMessageId
  if (boundary !== null) {
    const found = messages.find((message) => !message.outgoing && message.id > boundary)
    return found?.id ?? null
  }
  const fallback = messages[Math.max(0, messages.length - marker.unread)]
  return fallback?.id ?? null
}

/**
 * Whether the saved reading position outranks the unread divider.
 *
 * Message ids grow with time, so a position *after* the read boundary means the
 * reader had already reached the new messages when they left — restoring it keeps
 * them where they were. A position at or before the boundary means they were
 * reading older history, and the divider is the only place that shows what is new.
 * Without a read marker the boundary is unknown, so the divider wins.
 */
export function anchorBeatsUnread(marker: UnreadBoundary | null, anchorMessageId: number): boolean {
  if (!marker || marker.unread <= 0) return true
  if (marker.lastReadInboxMessageId === null) return false
  return anchorMessageId > marker.lastReadInboxMessageId
}

/**
 * The message id the first page must contain, or null when the newest page is
 * enough. Paging back is not free on the real account, so this is decided once,
 * before any history is fetched.
 */
export function pickPagingTarget(
  anchor: { messageId: number } | null,
  marker: UnreadBoundary | null,
): PagingTarget | null {
  if (marker && marker.unread > 0 && marker.lastReadInboxMessageId !== null) {
    if (anchor && anchorBeatsUnread(marker, anchor.messageId)) {
      return { kind: 'anchor', messageId: anchor.messageId }
    }
    // Page back to the read boundary itself: the first message past it is the one
    // the divider goes above, whatever the message ids actually are.
    return { kind: 'unread', messageId: marker.lastReadInboxMessageId }
  }
  return anchor ? { kind: 'anchor', messageId: anchor.messageId } : null
}

/**
 * Where a 定位到聊天位置 request lands: the requested row at the very top of the
 * viewport, so the flashed bubble is fully visible (the list centres it afterwards
 * only if it has to). Null when the row is not in this window — the caller then
 * falls back to the normal landing rule.
 */
export function locateLanding(
  messages: Message[],
  messageId: number | null,
): LandingPosition | null {
  if (messageId === null) return null
  return messages.some((message) => message.id === messageId)
    ? { kind: 'anchor', messageId, offset: 0 }
    : null
}

/**
 * The one rule for "where does this chat open": a saved position that is at or
 * after the read boundary, else the unread divider, else the saved position,
 * else the newest message. A saved position that is not in the loaded window
 * cannot be honoured and is treated as absent.
 */
export function resolveLanding(
  messages: Message[],
  marker: UnreadBoundary | null,
  anchor: { messageId: number; offset: number } | null,
): LandingPosition | null {
  const saved =
    anchor && messages.some((message) => message.id === anchor.messageId) ? anchor : null
  if (saved && anchorBeatsUnread(marker, saved.messageId)) {
    return { kind: 'anchor', messageId: saved.messageId, offset: saved.offset }
  }
  const unread = findUnreadMessage(messages, marker)
  if (unread !== null) return { kind: 'unread', messageId: unread }
  return saved ? { kind: 'anchor', messageId: saved.messageId, offset: saved.offset } : null
}
