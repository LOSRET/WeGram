/**
 * The one reading of a search box's value.
 *
 * Four panels filter by a query (chat list, address book, 搜索 tab, emoji table)
 * and each had grown its own `trim().toLowerCase()`; a fifth would have been
 * written from whichever neighbour its author happened to open.
 */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Case-insensitive substring match. An empty needle never matches: callers that
 * want "no query means everything" test the needle first (see `MainShell`).
 */
export function containsText(haystack: string, needle: string): boolean {
  return needle.length > 0 && haystack.toLowerCase().includes(needle)
}

/** One run of a title: `hit` marks the part the query matched. */
export interface SearchSegment {
  text: string
  hit: boolean
}

/**
 * Split `text` where `needle` occurs, preserving the original casing, so a
 * result row can emphasise the matched run. The empty needle is one plain
 * segment: a caller with no query draws the title untouched.
 */
export function matchSegments(text: string, needle: string): SearchSegment[] {
  const query = needle.toLowerCase()
  if (query === '') return [{ text, hit: false }]
  const haystack = text.toLowerCase()
  const segments: SearchSegment[] = []
  let cursor = 0
  for (;;) {
    const at = haystack.indexOf(query, cursor)
    if (at === -1) break
    if (at > cursor) segments.push({ text: text.slice(cursor, at), hit: false })
    segments.push({ text: text.slice(at, at + query.length), hit: true })
    cursor = at + query.length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false })
  return segments.length > 0 ? segments : [{ text, hit: false }]
}
