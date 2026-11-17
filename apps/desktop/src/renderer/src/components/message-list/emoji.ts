/**
 * True when the text is nothing but emoji (Telegram's animated-emoji messages, or
 * plain text made of emoji). Such a message is rendered bubble-less at large size,
 * the way WeChat shows big emoji.
 *
 * Kept in its own pure module so it can be unit-tested without mounting the row
 * (which drags in the sticker renderer and the whole media stack).
 */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim()
  // Length cap keeps multi-line emoji spam inside a normal bubble.
  if (!trimmed || trimmed.length > 12) return false
  // Digits are not pictographic, so plain "123" cannot pass the first test; the
  // second keeps keycaps, skin tones, ZWJ sequences and VS16 in play.
  if (!/\p{Extended_Pictographic}/u.test(trimmed)) return false
  return /^[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F\u20E3\s]+$/u.test(trimmed)
}
