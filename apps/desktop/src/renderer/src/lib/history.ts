import type { Message } from '@wechatgram/protocol'

/**
 * The one rule behind "may this empty page be cached as the chat's history".
 *
 * `messages:history` answering `[]` is ambiguous: it can be the chat's history, or a
 * fetch that has not reached the server yet (a cold local TDLib database, a flapping
 * proxy). The renderer can tell them apart without asking again: the chat list only
 * carries `lastMessageAt` when TDLib reported a `last_message` for the chat, which is
 * the same field the adapter anchors its first page on. So an empty page for a chat
 * that has a last message is *not* the history — caching it is what turned one slow
 * sync into a blank transcript for the rest of the session (recovered only by 重新加载).
 *
 * An unknown chat (not in the loaded chat list) is treated as empty rather than as
 * "keep retrying forever": no chat that can be opened is outside that list, and the
 * alternative is a transcript that never settles.
 */
export function emptyPageIsHistory(
  page: { messages: Message[] },
  chat: { lastMessageAt?: number | undefined } | undefined,
): boolean {
  return page.messages.length === 0 && chat?.lastMessageAt === undefined
}
