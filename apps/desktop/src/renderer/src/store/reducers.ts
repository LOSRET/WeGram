import type { ChatSummary, Message, MessageOp } from '@wechatgram/protocol'

/**
 * Pure state transitions of the message/chats store.
 *
 * These live apart from the zustand slices on purpose: they are the part of the
 * store an agent can change and verify without a browser (`reducers.test.ts`),
 * and they carry the invariants that are easy to break silently.
 */

/** Ops queued for a chat whose first page has not landed yet. */
export const PENDING_OPS_LIMIT = 200

/** Shared frozen empty list, so a missing chat does not allocate on every render. */
export const EMPTY_MESSAGES: Message[] = []

/** Pinned first, then newest activity — the order WeChat shows. */
export function sortChats(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  })
}

export function upsertMessage(list: Message[], message: Message): Message[] {
  const index = list.findIndex((item) => item.id === message.id)
  if (index === -1) return [...list, message]
  const next = [...list]
  next[index] = message
  return next
}

/**
 * Apply message ops to an in-memory list.
 *
 * Shared by `applyMessageOps` (live events) and `setHistory` (replaying the ops
 * that arrived while the first page was still being fetched). Returns the ids
 * that were deleted so the caller can drop references to them (edit banner, reply
 * target).
 */
export function reduceOps(
  list: Message[],
  ops: MessageOp[],
): { list: Message[]; deleted: Set<number> } {
  let next = list
  const deleted = new Set<number>()
  for (const op of ops) {
    switch (op.op) {
      case 'new':
      case 'replace':
        next = upsertMessage(next, op.message)
        break
      case 'edit':
        next = next.map((item) =>
          item.id === op.messageId ? { ...item, text: op.text, edited: true } : item,
        )
        break
      case 'delete':
        for (const id of op.messageIds) deleted.add(id)
        next = next.filter((item) => !op.messageIds.includes(item.id))
        break
      default:
        break
    }
  }
  return { list: next, deleted }
}

/**
 * Whether an op batch carries anything worth queueing while a chat's first page
 * is in flight. Read markers arrive for every chat and change nothing in the
 * transcript, so they must not fill the queue.
 */
export function hasReplayableOps(ops: MessageOp[]): boolean {
  return ops.some((op) => op.op !== 'read')
}
