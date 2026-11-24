/**
 * Container heights the chat list lays out with.
 *
 * The virtualiser needs a row height before anything is measured, so the number
 * cannot come from the CSS token at runtime; `--wx-list-item-h` in
 * `styles/tokens.css` is the same measurement and `styleContract.test.ts` fails
 * if the two drift (they did once: the rows slid by a pixel per scroll).
 */
export const CHAT_ROW_H = 65

/** Rows kept painted outside the viewport, so a fast wheel never shows white. */
export const LIST_OVERSCAN = 8

/**
 * How wide a message stack may grow: `.wx-message-stack`'s `max-width` in
 * `styles/message-rows.css` (`min(560px, 66%)` of the row). Text bubbles live by
 * it; an album does not — Telegram lets media be wider than a bubble, so an album
 * takes the row's own space (`MSG_AVATAR` + `MSG_ROW_GAP` removed) up to its own
 * 430 px. `styleContract.test.ts` keeps all three numbers equal to the stylesheet.
 */
export const STACK_MAX_WIDTH = 560
export const STACK_MAX_FRACTION = 0.66

/** `.wx-avatar--small` (`--wx-avatar-msg`) and `.wx-message-row`'s `gap`. */
export const MSG_AVATAR = 38
export const MSG_ROW_GAP = 9
