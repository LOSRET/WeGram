/**
 * When several picked files become ONE album instead of N messages.
 *
 * Telegram's albums hold 2–10 photos (and videos, which this picker cannot
 * choose), and they are the only set the transcript folds back into a single
 * bubble — `rows.ts` joins consecutive photo/video rows that share an album id.
 * So:
 *
 *  - one file is a normal `media:send` (an album of one does not exist),
 *  - more than ten is sent one by one, because splitting a selection across an
 *    album and a tail would need a UI that names the split,
 *  - a document selection stays one message each: Telegram accepts document
 *    albums, but this transcript would draw them as separate bubbles anyway, so
 *    promising a "folded" group there would be a lie.
 */
export const ALBUM_MIN = 2
export const ALBUM_MAX = 10

export interface AlbumItem {
  filePath: string
  kind: 'photo' | 'file'
}

/**
 * The album payload for these picks, or null to send them one at a time.
 */
export function albumSendOf(
  paths: readonly string[],
  kind: AlbumItem['kind'],
): AlbumItem[] | null {
  if (kind !== 'photo') return null
  if (paths.length < ALBUM_MIN || paths.length > ALBUM_MAX) return null
  return paths.map((filePath) => ({ filePath, kind }))
}
