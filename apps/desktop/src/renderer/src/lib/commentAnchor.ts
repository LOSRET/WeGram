import type { ScrollAnchor } from '@wegram/protocol'

/**
 * Where the discussion view lands when it opens (design doc §9.8).
 *
 * A stored row wins only while it is inside the loaded window. The first page is
 * always the newest comments, so after a restart a deeper row would cost one
 * `messages:comments` request per page just to be reached — the panel opens at the
 * top of the thread instead. `null` is that default: the oldest loaded comment
 * sits directly under the pinned post, and scrolling up pages further back.
 */
export function resolveCommentLanding(
  messages: readonly { id: number }[],
  anchor: ScrollAnchor | null,
): ScrollAnchor | null {
  if (anchor === null) return null
  return messages.some((message) => message.id === anchor.messageId) ? anchor : null
}
