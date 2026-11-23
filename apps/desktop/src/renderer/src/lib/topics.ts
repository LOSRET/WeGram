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
 * How long the topic page takes to slide over the message pane. Same 0.2 s as
 * 已归档会话 and 聊天信息 — the three overlays share one beat, and
 * `style-contract.test.ts` pins this number to the stylesheet.
 */
export const TOPICS_PAGE_ANIM_MS = 200