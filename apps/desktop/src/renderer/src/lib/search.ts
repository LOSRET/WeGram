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
