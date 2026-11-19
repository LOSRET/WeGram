import type { Message } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapMessage } from '../map/message'
import type { ActionDeps } from './deps'

/**
 * One page of history, ascending, plus whether older messages may exist.
 *
 * Measured quirk that made groups look unloadable: `getChatHistory` happily
 * answers from the local database and then returns only the handful of
 * messages it has cached — 1 to 5 for a cold group, in ~2 ms — even when the
 * chat has thousands of messages. Anchoring *below* that short answer is the
 * request TDLib does take to the server, and it comes back full. So a short
 * answer is topped up here, and only an empty round counts as "the chat
 * begins here".
 *
 * The old `hasMore: rawMessages.length >= limit` read every short answer as
 * "no more history", which stopped MessageList from paging at all.
 */
export async function history(
  deps: ActionDeps,
  input: { chatId: number; fromMessageId?: number; limit: number },
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(input.limit, 1), 100)

  // Measured behaviour (probe in RESULTS.md): from_message_id = 0 does not
  // trigger a server fetch — it only returns the locally cached last message.
  // A real page needs an existing message id as anchor, so the first page
  // anchors on chat.last_message.
  let anchor = input.fromMessageId
  if (anchor === undefined) {
    const chat = await deps.invoke({ _: 'getChat', chat_id: input.chatId })
    const lastId: number | undefined = chat.last_message?.id
    if (!lastId) {
      // The whole conversation renders empty when this happens, and the
      // renderer caches the empty page, so it never retries — log which half
      // of the chain produced it.
      deps.logger.warn(
        `history: chat ${input.chatId} has no last_message (${
          chat.last_message === null ? 'null' : typeof chat.last_message
        }) — returning an empty first page`,
      )
      return { messages: [], hasMore: false }
    }
    // `getChatHistory` returns messages *older than* `from_message_id` (it is
    // exclusive; measured 2026-11-17: from=4975493120 answered 4974444544…).
    // Anchoring exactly on the last message therefore dropped the newest message
    // from the first page — one message was never loaded, and `openChat` marked
    // the wrong id as read, so the unread badge never cleared. One past the last
    // message is the request that includes it.
    anchor = lastId + 1
  }

  const collected: TdObject[] = []
  const seen = new Set<number>()
  let cursor: number = anchor
  // The first page includes its anchor, because the implicit anchor above is one
  // past the last message; every later round is strictly older.
  let below = input.fromMessageId
  let exhausted = false
  // A short answer is topped up over a few rounds; bounded so a slow link
  // cannot stall the first paint.
  const MAX_ROUNDS = 3

  for (let round = 0; round < MAX_ROUNDS && collected.length < limit; round += 1) {
    const response = await deps.invoke({
      _: 'getChatHistory',
      chat_id: input.chatId,
      from_message_id: cursor,
      offset: 0,
      limit: limit - collected.length,
      only_local: false,
    })
    const rawMessages: TdObject[] = Array.isArray(response.messages) ? response.messages : []
    const fresh = rawMessages.filter((raw) => {
      const id = Number(raw.id)
      if (!Number.isFinite(id) || seen.has(id)) return false
      return below === undefined || id < below
    })
    if (fresh.length === 0) {
      exhausted = true
      break
    }
    for (const raw of fresh) {
      seen.add(Number(raw.id))
      collected.push(raw)
    }
    const oldest = Math.min(...fresh.map((raw) => Number(raw.id)))
    cursor = oldest
    below = oldest
  }

  // getChatHistory returns newest first; the UI wants ascending order, and a
  // top-up round can overshoot, so keep the newest `limit` of what we have.
  const ordered = [...collected].sort((a, b) => Number(a.id) - Number(b.id))
  const page = ordered.length > limit ? ordered.slice(ordered.length - limit) : ordered
  if (page.length === 0) {
    // Only the *first* page is a problem here: an empty "older" page is the
    // normal end of history. An empty first page renders as a silent blank
    // transcript and gets cached by the renderer.
    deps.logger.warn(
      `history: getChatHistory returned nothing for chat ${input.chatId} from ${cursor} (anchor ${
        input.fromMessageId ?? 'last_message'
      }, limit ${limit})`,
    )
  }
  const mapped = await Promise.all(page.map((raw) => mapMessage(deps.mapper, input.chatId, raw)))
  return { messages: mapped, hasMore: !exhausted && mapped.length > 0 }
}

/** One side of an around window; the protocol caps it at 50 as well. */
const AROUND_LIMIT = 50

/** Newest message id the chat knows about, or 0 when it has no messages yet. */
async function newestMessageId(deps: Pick<ActionDeps, 'invoke'>, chatId: number): Promise<number> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  return Number(chat?.last_message?.id ?? 0)
}

/** Raw messages -> mapped, ascending, de-duplicated by id. */
async function mapRawPage(
  deps: Pick<ActionDeps, 'invoke' | 'mapper'>,
  chatId: number,
  rawMessages: TdObject[] | undefined,
): Promise<Message[]> {
  const byId = new Map<number, TdObject>()
  for (const raw of rawMessages ?? []) {
    const id = Number(raw.id)
    if (Number.isFinite(id)) byId.set(id, raw)
  }
  const ordered = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id))
  return Promise.all(ordered.map((raw) => mapMessage(deps.mapper, chatId, raw)))
}

/**
 * The messages strictly newer than `fromMessageId`.
 *
 * TDLib has no "history onwards" call: a *negative* offset on `getChatHistory`
 * answers the messages after the anchor (measured in Spike 2, RESULTS.md #2.3).
 * The anchor itself comes back excluded because `from_message_id` is exclusive,
 * and the filter repeats the comparison instead of trusting the page's order.
 */
async function fetchNewerThan(
  deps: Pick<ActionDeps, 'invoke' | 'mapper'>,
  chatId: number,
  fromMessageId: number,
  size: number,
): Promise<Message[]> {
  const response = await deps.invoke({
    _: 'getChatHistory',
    chat_id: chatId,
    from_message_id: fromMessageId,
    offset: -size,
    limit: size,
    only_local: false,
  })
  const rawNewer = (Array.isArray(response.messages) ? response.messages : []).filter(
    (raw: TdObject) => Number(raw.id) > fromMessageId,
  )
  return mapRawPage(deps, chatId, rawNewer)
}

/**
 * A contiguous window centred on one message, for a reading position or an
 * unread boundary that is older than the newest page.
 *
 * This is what makes a deep position reachable without walking the gap first:
 * messages:history can only page back from the newest message, so restoring a
 * position 5 000 messages up used to cost fifty round trips (the renderer gave
 * up after six pages). Two requests are enough here:
 *
 *  - older: history() (the robust top-up pager) anchored on the message;
 *  - newer: getChatHistory with a *negative* offset, which returns messages
 *    newer than the anchor (measured in Spike 2, RESULTS.md #2.3);
 *  - the anchor itself: getChatHistory is exclusive, so getMessage supplies it.
 *
 * hasNewer means the window does not reach the newest message; the renderer
 * then appends via messages:newer as the reader scrolls down instead of
 * pretending the window ends at the latest message.
 */
export async function historyAround(
  deps: ActionDeps,
  input: { chatId: number; messageId: number; limit: number },
): Promise<{ messages: Message[]; hasMore: boolean; hasNewer: boolean }> {
  const size = Math.min(Math.max(input.limit, 1), AROUND_LIMIT)
  const [lastId, older] = await Promise.all([
    newestMessageId(deps, input.chatId),
    history(deps, {
      chatId: input.chatId,
      fromMessageId: input.messageId,
      limit: size,
    }),
  ])

  const newer = await fetchNewerThan(deps, input.chatId, input.messageId, size)

  let anchor: Message | null = null
  try {
    const raw = await deps.invoke({
      _: 'getMessage',
      chat_id: input.chatId,
      message_id: input.messageId,
    })
    if (raw && raw._ !== 'error' && Number(raw.id) === input.messageId) {
      anchor = await mapMessage(deps.mapper, input.chatId, raw)
    }
  } catch {
    // A deleted anchor is normal: the window still carries its neighbours.
  }

  const byId = new Map<number, Message>()
  for (const message of older.messages) byId.set(message.id, message)
  if (anchor) byId.set(anchor.id, anchor)
  for (const message of newer) byId.set(message.id, message)
  const messages = [...byId.values()].sort((a, b) => a.id - b.id)
  const newest = messages.at(-1)?.id ?? 0
  return {
    messages,
    hasMore: older.hasMore,
    hasNewer: lastId > 0 && newest < lastId,
  }
}

/**
 * The page immediately below an anchored window. Needed because an around
 * window does not reach the newest message; the reader scrolls down and the
 * transcript extends instead of jumping.
 */
export async function historyNewer(
  deps: ActionDeps,
  input: { chatId: number; fromMessageId: number; limit: number },
): Promise<{ messages: Message[]; hasNewer: boolean }> {
  const size = Math.min(Math.max(input.limit, 1), 100)
  const lastId = await newestMessageId(deps, input.chatId)
  const messages = await fetchNewerThan(deps, input.chatId, input.fromMessageId, size)
  const newest = messages.at(-1)?.id ?? input.fromMessageId
  return { messages, hasNewer: lastId > 0 && newest < lastId }
}
