import { GENERAL_TOPIC_ID } from '@wegram/protocol'
import type { ChatOp, ChatSummary, Message, MessageOp } from '@wegram/protocol'

/**
 * Pure state transitions of the message/chats store.
 *
 * These live apart from the zustand slices on purpose: they are the part of the
 * store an agent can change and verify without a browser (`reducers.test.ts`),
 * and they carry the invariants that are easy to break silently.
 */

/**
 * 话题 (design doc §9.12): a live message op belongs to exactly one topic, and the
 * transcript in memory holds one topic's rows. Applying another topic's `new` or
 * `replace` would put a message under the wrong heading; edits and deletions only
 * name ids, so they pass through and are no-ops for rows that are not loaded.
 *
 * A message without a topic is General (id 1) — TDLib leaves the field out for the
 * General topic, and a fixture may do the same.
 */
export function filterOpsForTopic(ops: MessageOp[], topicId: number): MessageOp[] {
  return ops.filter((op) => {
    if (op.op !== 'new' && op.op !== 'replace') return true
    return (op.message.topicId ?? GENERAL_TOPIC_ID) === topicId
  })
}

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

/** The renderer's two conversation lists (Main and 已归档). */
export interface ChatLists {
  chats: ChatSummary[]
  archivedChats: ChatSummary[]
}

/**
 * Route chat ops into the two lists.
 *
 * An upsert is also a move: 归档 is not a deletion — a `remove` op would drop the
 * transcript with the row — so the summary's `archived` flag decides which list
 * holds the chat. That one rule covers archiving from the menu, unarchiving, and
 * TDLib moving a chat by itself when it is unarchived on another device.
 *
 * Returns the ids that a `remove` op deleted separately: the caller has to drop
 * their transcripts and paging state too.
 */
/**
 * Add a page of chats to a list without disturbing what is already there.
 *
 * Two callers need this and neither may replace: 分页 appends slices of the
 * server's list as the reader reaches the end, and the event-gap resync re-reads
 * the first page to repair what a dropped event left stale. In both cases the
 * incoming row wins (it is the freshest read) and a row the page does not
 * mention survives — a replacement would drop every page already loaded.
 */
export function mergeChatList(current: ChatSummary[], page: ChatSummary[]): ChatSummary[] {
  if (page.length === 0) return current
  const byId = new Map(current.map((chat) => [chat.id, chat]))
  for (const chat of page) byId.set(chat.id, chat)
  return sortChats([...byId.values()])
}

/** The two conversation lists the store keeps (TDLib `chatListMain` / `chatListArchive`). */
export type ChatListName = 'main' | 'archive'

export function routeChatOps(
  current: ChatLists,
  ops: ChatOp[],
): ChatLists & { removed: number[] } {
  const main = new Map(current.chats.map((chat) => [chat.id, chat]))
  const archive = new Map(current.archivedChats.map((chat) => [chat.id, chat]))
  const removed: number[] = []
  for (const op of ops) {
    if (op.op === 'upsert') {
      main.delete(op.chat.id)
      archive.delete(op.chat.id)
      const target = op.chat.archived === true ? archive : main
      target.set(op.chat.id, op.chat)
      continue
    }
    main.delete(op.chatId)
    archive.delete(op.chatId)
    removed.push(op.chatId)
  }
  return {
    chats: sortChats([...main.values()]),
    archivedChats: sortChats([...archive.values()]),
    removed,
  }
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
      case 'poll':
        next = next.map((item) => (item.id === op.messageId ? { ...item, poll: op.poll } : item))
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
      /**
       * 表情回应: TDLib sends the complete list, so this replaces the chips; an
       * empty answer removes them (the last person took their reaction back).
       */
      case 'reactions':
        next = next.map((item) => {
          if (item.id !== op.messageId) return item
          const { reactions: _previous, ...rest } = item
          return op.reactions.length > 0 ? { ...rest, reactions: op.reactions } : rest
        })
        break
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

/**
 * Apply live ops to a transcript a component owns.
 *
 * The discussion view (design doc §9.8) keeps a thread of its own: those rows
 * never enter `messagesByChat`, so the store's op stream is the only way a vote,
 * an edit or a deletion inside it can reach the card the reader is looking at.
 * Without it a poll vote landed on the server while the card kept its old counts,
 * and the next tap was refused as a revote (design doc §9.10).
 *
 * Only ops that name a row the window already holds apply. A live arrival is the
 * newest page's job: splicing one into a list that stops short would draw it under
 * a row it does not follow.
 */
export function reduceLoadedOps(
  list: Message[],
  chatId: number,
  ops: MessageOp[],
): Message[] {
  if (list.length === 0) return list
  const held = new Set(list.map((message) => message.id))
  const applicable = ops.filter((op) => {
    switch (op.op) {
      case 'new':
      case 'read':
        return false
      case 'replace':
        return op.message.chatId === chatId && held.has(op.message.id)
      case 'edit':
      case 'poll':
      case 'sendState':
      case 'reactions':
      case 'interaction':
        return held.has(op.messageId)
      case 'replaceId':
        return held.has(op.oldId)
      case 'delete':
        return op.messageIds.some((id) => held.has(id))
    }
  })
  if (applicable.length === 0) return list
  return reduceOps(list, applicable).list
}

