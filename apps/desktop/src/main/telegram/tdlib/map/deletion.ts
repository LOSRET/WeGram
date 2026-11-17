/**
 * `updateDeleteMessages` covers two very different events, and only one of them
 * may touch the transcript.
 *
 * The cache-only variant is what TDLib sends when it trims its own local
 * database: `from_cache: true` means the messages "can possibly be retrieved
 * again in the future" (their own doc comment). Measured on the real account
 * (2026-11-17): an idle app in the background received
 * `{from_cache: true, is_permanent: false}` for **all 50** cached messages of the
 * open chat, the renderer dropped every row, and the pane settled on
 * "这个会话还没有可显示的消息" until 重新加载 refetched them from the server. Nothing
 * was deleted — TDLib had merely evicted its cache.
 *
 * So: a deletion that the server will still serve must not remove rows. Only a
 * real deletion (`from_cache: false` — permanently deleted, or become
 * inaccessible) is allowed to. `is_permanent` is deliberately not used to decide:
 * a message deleted "for both sides" and one that merely became inaccessible are
 * both gone from the transcript, while a cache eviction is not.
 */
export function isTranscriptRemoval(update: {
  is_permanent?: boolean
  from_cache?: boolean
}): boolean {
  return update.from_cache !== true
}
