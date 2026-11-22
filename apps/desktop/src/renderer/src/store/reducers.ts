import type { ChatSummary, Message, MessageOp } from '@wegram/protocol'

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
      /**
       * A failed/pending badge moved. The row keeps its id, so this is a patch;
       * a state update for a row that is not loaded changes nothing (it will be
       * in the history page when the reader gets there).
       */
      case 'sendState':
        next = next.map((item) =>
          item.id === op.messageId
            ? {
                ...item,
                sendingState: op.sendingState,
                ...(op.sendError === undefined ? {} : { sendError: op.sendError }),
                ...(op.canRetry === undefined ? {} : { canRetry: op.canRetry }),
              }
            : item,
        )
        break
      /**
       * TDLib swaps a pending message's id for the server one. The row stays where
       * it is, but its id must change or every later edit / delete / read receipt
       * would name a message the server does not know.
       */
      case 'replaceId': {
        const index = next.findIndex((item) => item.id === op.oldId)
        if (index === -1) break
        const updated = [...next]
        updated[index] = op.message
        next = updated
        break
      }
      case 'interaction':
        // A counter patch, never a replacement: an update carries only the
        // fields that changed (a view count, a fresh reply count), so merging
        // keeps whatever it does not mention. `comments` is required on a
        // stored interaction and a patch may omit it, so it is narrowed here;
        // a view-only patch for a row without an interaction changes nothing.
        next = next.map((item) => {
          if (item.id !== op.messageId) return item
          const comments = op.interaction.comments ?? item.interaction?.comments
          if (comments === undefined) return item
          return { ...item, interaction: { ...item.interaction, ...op.interaction, comments } }
        })
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

/**
 * Split ops for a window that does not reach the newest message.
 *
 * An anchored window knows two ids: the oldest and the newest loaded row. Ops
 * for a row inside that range apply as usual. A *newer* row cannot be spliced on
 * yet — that would draw it directly under the window's last row and leave a
 * silent gap in the transcript — so it is deferred until the window reaches it.
 * A row older than the window belongs to a page nobody loaded and is dropped:
 * paging up will fetch it with its neighbours.
 *
 * Id-only ops (edit, delete, read) always apply: they cannot invent a row.
 */
export function splitOpsForWindow(
  list: Message[],
  ops: MessageOp[],
): { applicable: MessageOp[]; deferred: MessageOp[] } {
  const firstId = list[0]?.id ?? 0
  const lastId = list[list.length - 1]?.id ?? 0
  const applicable: MessageOp[] = []
  const deferred: MessageOp[] = []
  for (const op of ops) {
    if (op.op === 'new' || op.op === 'replace') {
      if (op.message.id > lastId) {
        deferred.push(op)
      } else if (op.message.id >= firstId) {
        applicable.push(op)
      }
      continue
    }
    applicable.push(op)
  }
  return { applicable, deferred }
}

/** De-duplicating append for an anchored window; ids can only grow. */
export function appendNewerMessages(list: Message[], messages: Message[]): Message[] {
  const lastId = list.at(-1)?.id ?? 0
  const seen = new Set(list.map((message) => message.id))
  const added = messages
    .filter((message) => message.id > lastId && !seen.has(message.id))
    .sort((a, b) => a.id - b.id)
  return added.length > 0 ? [...list, ...added] : list
}
