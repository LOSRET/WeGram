/**
 * When several picked files become ONE album instead of N messages.
 *
 * Telegram's albums hold 2–10 photos **and videos** — exactly the set the
 * transcript folds back into a single bubble (`rows.ts` joins consecutive
 * photo/video rows that share an album id), and mixing the two in one album is
 * what 图片与视频 offers. So:
 *
 *  - one file is a normal `media:send` (an album of one does not exist),
 *  - more than ten is sent one by one, because splitting a selection across an
 *    album and a tail would need a UI that names the split,
 *  - a document selection stays one message each: a document row would break the
 *    fold (and share the album's key), so a "folded" group there would be a lie.
 */
export const ALBUM_MIN = 2
export const ALBUM_MAX = 10

export interface AlbumItem {
  filePath: string
  kind: 'photo' | 'video'
}

/** One picked path and what it becomes; a document disqualifies the album. */
export interface PickedAttachment {
  filePath: string
  kind: 'photo' | 'video' | 'file'
}

/**
 * The album payload for these picks, or null to send them one at a time.
 */
export function albumSendOf(items: readonly PickedAttachment[]): AlbumItem[] | null {
  if (items.length < ALBUM_MIN || items.length > ALBUM_MAX) return null
  const album: AlbumItem[] = []
  for (const item of items) {
    if (item.kind === 'file') return null
    album.push({ filePath: item.filePath, kind: item.kind })
  }
  return album
}
