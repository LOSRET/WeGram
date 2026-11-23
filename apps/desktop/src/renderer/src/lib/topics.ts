import type { ChatTopic } from '@wegram/protocol'

import type { UnreadBoundary } from './unreadBoundary'

/**
 * 话题 (design doc §9.12): the small pure rules the topic list and the transcript
 * share — the icon colour, the unread divider's snapshot and the panel's timing.
 *
 * Kept React-free so `pnpm test` can pin them, like every other rule in this folder.
 */

/**
 * The icon colour TDLib sends as 0xRRGGBB. A opaque swatch is always given (the
 * server always sends a colour); a value that is not a colour falls back to the
 * first palette entry rather than rendering `#NaN`.
 */
export function topicSwatch(color: number): string {
  const value = Number.isFinite(color) ? Math.floor(color) : 0
  if (value <= 0 || value > 0xffffff) return '#6fb9f0'
  return `#${value.toString(16).padStart(6, '0')}`
}

/**
 * What the transcript should treat as this topic's unread boundary when it opens.
 * `null` when the topic has nothing unread (no divider), mirroring the chat's own
 * snapshot (`UnreadBoundary`).
 */
export function topicUnreadMarker(topic: ChatTopic | null | undefined): UnreadBoundary | null {
  if (!topic || topic.unread <= 0) return null
  return {
    lastReadInboxMessageId: topic.lastReadInboxMessageId ?? null,
    unread: topic.unread,
  }
}

/** The topic list's row label for the unread badge: nothing at zero. */
export function topicBadge(topic: ChatTopic): number | null {
  return topic.unread > 0 ? topic.unread : null
}

/**
 * The two read markers a transcript reads, whatever row it belongs to.
 *
 * TDLib keeps a pair per topic (`forumTopic.last_read_inbox/outbox_message_id`)
 * and a chat-level pair that describes the General topic. The transcript's buoy,
 * its 已读/未读 receipt and the "still unread below the fold" count must come from
 * the row the reader is looking at, or a fully read topic keeps shouting
 * "N 条新消息" and its own sent rows stay on 未读 — so the pane takes the pair from
 * the topic row while one is open and from the chat otherwise, then runs the
 * ordinary chat logic on it.
 */
export interface TranscriptReadMarkers {
  /** Highest incoming id the server counts as read; null when it never answered. */
  inboxMessageId: number | null
  /** Highest outgoing id the members have read; 0 when they have read nothing. */
  outboxMessageId: number
}

/** A row that carries the marker pair: a `ChatSummary` or a `ChatTopic`. */
type ReadMarkerSource = {
  lastReadInboxMessageId?: number
  lastReadOutboxMessageId?: number
}

/** The markers of the row the transcript is showing; `null` means "nothing read". */
export function transcriptReadMarkers(scope: ReadMarkerSource | null): TranscriptReadMarkers {
  return {
    inboxMessageId: scope?.lastReadInboxMessageId ?? null,
    outboxMessageId: scope?.lastReadOutboxMessageId ?? 0,
  }
}

/**
 * How long the topic page takes to slide over the message pane. Same 0.2 s as
 * 已归档会话 and 聊天信息 — the three overlays share one beat, and
 * `style-contract.test.ts` pins this number to the stylesheet.
 */
export const TOPICS_PAGE_ANIM_MS = 200
