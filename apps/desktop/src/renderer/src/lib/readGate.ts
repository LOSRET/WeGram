/**
 * The one rule behind "this message counts as read on this device".
 *
 * Receiving is not seeing. A message the reader never had on screen must not be
 * reported as read: that silently clears the badge, the chat list forgets, and the
 * reader never learns there was anything new. So the gate is "it was visible +
 * the window is visible + the window is focused", and the *id* passed in decides
 * how far the read marker moves.
 *
 * Granularity matters, not just the boolean. Telegram's read marker
 * (`last_read_inbox_message_id`) is monotonic, so reporting **the newest message
 * that has actually been on screen** is exactly right: the server answers with the
 * remaining `unread_count`, which is what the chat row and the rail badge show.
 * The old rule ("only while at the bottom") meant a reader scrolling down through
 * twenty unread messages kept every badge until the very last pixel — the pill and
 * the badges disagreed with the transcript.
 */
export interface ReadGate {
  /** Newest message whose row has been on screen; null when none has been. */
  seenUpToMessageId: number | null
  /** The window is not hidden behind another one. */
  visible: boolean
  /** The pane is the one the reader is actually looking at. */
  focused: boolean
}

export function mayMarkRead(gate: ReadGate): boolean {
  return gate.seenUpToMessageId !== null && gate.visible && gate.focused
}
