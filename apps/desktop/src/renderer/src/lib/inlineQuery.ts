/** One `@bot query` typed into the composer (§8.3). */
export interface InlineQueryDraft {
  /** The bot's handle without the '@', lower-case as Telegram stores it. */
  username: string
  /** Everything after the handle; empty asks the bot for its defaults. */
  query: string
}

/**
 * inline 机器人: what `@bot query` in the composer means.
 *
 * Telegram's rule is positional: the message must *start* with an @username (the
 * client does not guess mid-sentence), a space separates it from the query, and
 * everything after that space is the query — spaces included, so "seed cat" asks
 * for "seed cat" and not for "seed".
 *
 * A bare `@name` without the separating space is not a query yet: the reader is
 * still typing the handle, and asking the server then would fire one call per
 * keystroke. Usernames are 5+ characters for bots, but the parse accepts 3 so the
 * panel cannot refuse a handle Telegram would allow.
 */
export function parseInlineQuery(text: string): InlineQueryDraft | null {
  if (!text.startsWith('@')) return null
  const match = /^@([A-Za-z0-9_]{3,32})[ \t\n]([\s\S]*)$/.exec(text)
  if (!match) return null
  const [, username, rest] = match
  if (!username) return null
  return { username: username.toLowerCase(), query: (rest ?? '').trim() }
}
