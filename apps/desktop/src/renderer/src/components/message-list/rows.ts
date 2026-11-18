import type { Message } from '@wegram/protocol'

/**
 * One transcript row: a single message, or the consecutive items of one Telegram
 * album (design doc §8.6).
 *
 * Telegram has no "one message with several media": an album is 2–10 separate
 * messages sharing `media_album_id`, and every official client folds consecutive
 * ones back into one bubble. TDLib keeps them separate, so the transcript does the
 * folding here and the virtualiser counts *rows*, not messages.
 */
export interface TranscriptRow {
  /**
   * Stable key for the virtualiser and for the DOM anchor the scroll hooks look
   * up: `m:<messageId>` for a lone message, `a:<albumId>` for an album.
   *
   * The album key names the album, not its first item, so it survives a history
   * page arriving above the group (the item ids of a row are not stable while
   * pagination is in flight).
   */
  key: string
  /** One message, or the album's items in transcript order. */
  messages: Message[]
}

/** Telegram albums hold photos and videos; nothing else joins a group. */
const ALBUM_KINDS: ReadonlySet<Message['kind']> = new Set<Message['kind']>(['photo', 'video'])

function sameSender(a: Message, b: Message): boolean {
  return a.outgoing === b.outgoing && a.senderId === b.senderId && a.senderChatId === b.senderChatId
}

function canJoinAlbum(open: Message, next: Message): boolean {
  return (
    Boolean(open.albumId) &&
    open.albumId === next.albumId &&
    ALBUM_KINDS.has(open.kind) &&
    ALBUM_KINDS.has(next.kind) &&
    sameSender(open, next)
  )
}

/**
 * Fold `messages` into rows. Album items are adjacent by construction, and a group
 * closes as soon as anything else sits between two items, so a history-page
 * boundary can only leave a *partial* album behind — it never merges two groups.
 */
export function groupMessages(messages: readonly Message[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let open: TranscriptRow | null = null

  for (const message of messages) {
    const last = open ? open.messages[open.messages.length - 1] : undefined
    if (open && last && canJoinAlbum(last, message)) {
      open.messages.push(message)
      continue
    }
    open = {
      key: message.albumId ? `a:${message.albumId}` : `m:${message.id}`,
      messages: [message],
    }
    rows.push(open)
  }

  return rows
}

/** Row index of the row that contains `messageId`, or -1. */
export function findRowIndex(rows: readonly TranscriptRow[], messageId: number): number {
  return rows.findIndex((row) => row.messages.some((message) => message.id === messageId))
}
