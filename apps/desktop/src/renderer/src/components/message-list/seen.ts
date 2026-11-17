import type { Message } from '@wegram/protocol'

/**
 * Which rows count as "seen", for the read marker and the "N new messages" pill.
 *
 * One definition for both: a row whose *top edge* is above the viewport's bottom
 * edge has been on screen, so the read marker may move up to it and the pill must
 * stop counting it. Two separate notions ("how far did the reader get" and "what is
 * still below the fold") drifted apart once already.
 *
 * Derived from the virtualiser's own layout instead of measuring every rendered
 * row: a slot is positioned at exactly `translateY(item.start)`, so `start` is the
 * row's offset whether its height has been measured or is still the estimate.
 * Reading N DOM rects per commit forced a synchronous layout for information the
 * virtualiser already had.
 */
export interface SeenPick {
  /** Highest list index that has been on screen, or -1 when none has. */
  newestIndex: number
  /** Highest message id that has been on screen, or null when none has. */
  newestId: number | null
}

export interface SeenInput {
  /** The virtualiser window: list index and its offset inside the sizer. */
  items: readonly { index: number; start: number }[]
  /**
   * The sizer's top edge relative to the scroller's top edge: the scroller's top
   * padding minus `scrollTop`, so negative once the transcript is scrolled.
   */
  sizerOffset: number
  viewportHeight: number
  /** Message id at a list index; `undefined` when the index is out of range. */
  idAt: (index: number) => number | undefined
}

export function pickSeenUpTo({ items, sizerOffset, viewportHeight, idAt }: SeenInput): SeenPick {
  let newestIndex = -1
  let newestId: number | null = null

  for (const item of items) {
    // `>=` on purpose: a row starting exactly at the viewport's bottom edge is not
    // on screen (it is the first row below the fold, i.e. the pill's own count).
    if (sizerOffset + item.start >= viewportHeight) continue
    const id = idAt(item.index)
    if (id === undefined) continue
    if (item.index > newestIndex) newestIndex = item.index
    if (newestId === null || id > newestId) newestId = id
  }

  return { newestIndex, newestId }
}

/** Lookup by message id, for the reply quote of every rendered row. */
export function messagesById(messages: readonly Message[]): Map<number, Message> {
  const byId = new Map<number, Message>()
  for (const message of messages) byId.set(message.id, message)
  return byId
}
