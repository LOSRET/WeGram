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
