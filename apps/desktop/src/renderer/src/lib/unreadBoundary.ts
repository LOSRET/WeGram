/**
 * What the chat looked like when it was opened: the read boundary and the unread
 * counter, captured *before* the read marker can move (opening no longer marks the
 * chat read; the list reports what it shows, a few hundred milliseconds later).
 *
 * One declaration: the list's landing logic and the store's snapshot used to
 * declare the same two fields separately, so a third field would have reached
 * only one of them.
 */
export interface UnreadBoundary {
  lastReadInboxMessageId: number | null
  unread: number
}
