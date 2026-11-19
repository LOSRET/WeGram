import type { Message, MessageInteraction } from '@wegram/protocol'

/**
 * Rules behind the comment bar under a message (design doc §9.8).
 *
 * Pure on purpose: `pnpm test` runs without a DOM, and these are the parts that
 * are easy to break silently — when a bar appears, how two pages of a thread
 * fit together, and how the counters read.
 */

/**
 * How many comments one request asks for. The discussion view is its own
 * scrollable pane, so a page can be generous; older pages load as the reader
 * reaches the top.
 */
export const COMMENT_PAGE = 30

/** A thread is identified by its chat and the commented message. */
export function commentKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`
}

/**
 * Whether the row draws a comment bar. WeChat hides the whole area when a post
 * has no comments, and so do we: a 0 next to an arrow invites a tap that shows
 * an empty list.
 */
export function hasCommentBar(interaction: MessageInteraction | undefined): boolean {
  return Boolean(interaction && interaction.comments > 0)
}

/**
 * A comment row is drawn with the transcript's own row, which would otherwise
 * offer its own comment bar: a reply to a comment must not open a third level of
 * discussion view. The interaction is dropped rather than hidden so `MessageRow`
 * sees an ordinary message.
 */
export function withoutCommentBar(message: Message): Message {
  if (!message.interaction) return message
  const rest: Message = { ...message }
  delete rest.interaction
  return rest
}

/**
 * Prepend a page of older comments to the ones already on screen.
 *
 * The request is exclusive (`messages:comments` pages below the cursor), so a
 * duplicate can only come from a live refresh; ids are the identity, and the
 * result is always ascending because that is how a thread reads. Anything newer
 * than the current first row is ignored — it belongs to a refresh of the newest
 * page, not above this one.
 */
export function mergeComments(current: Message[], older: Message[]): Message[] {
  const firstId = current[0]?.id ?? Number.POSITIVE_INFINITY
  const seen = new Set(current.map((message) => message.id))
  const added = older.filter((message) => !seen.has(message.id) && message.id < firstId)
  if (added.length === 0) return current
  return [...added, ...current].sort((a, b) => a.id - b.id)
}

/**
 * 1.2万 / 3.4亿 style counts, as WeChat prints view numbers. One decimal, and
 * a trailing `.0` is dropped; below 10 000 the exact number is shown.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 100_000_000) return `${trimUnit(value / 100_000_000)}亿`
  if (value >= 10_000) return `${trimUnit(value / 10_000)}万`
  return String(Math.round(value))
}

function trimUnit(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
