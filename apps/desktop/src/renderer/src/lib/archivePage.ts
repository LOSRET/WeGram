/**
 * How long 已归档会话's page takes to slide in over the conversation list.
 *
 * The page lives inside the list column, so it is mounted closed and flipped
 * `is-open` on the next tick; the list keeps it mounted for exactly this long
 * after the close so the slide back is seen. Same rule as 聊天信息
 * (`INFO_PANEL_ANIM_MS`): the number is written twice — here for the unmount timer
 * and in `styles/chat-list.css` for the browser — and `style-contract.test.ts`
 * pins the two together.
 */
export const ARCHIVE_PAGE_ANIM_MS = 200
