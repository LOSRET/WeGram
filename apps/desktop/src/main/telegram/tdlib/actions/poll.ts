import { AppError } from '@wegram/protocol'
import type { InvokeRequest, Poll } from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import type { MapperContext } from '../map/context'
import { mapMessage } from '../map/message'
import type { ActionDeps } from './deps'
import { formattedText } from './message-input'

/** How many chat/message pairs the painted-poll memory keeps before it drops the oldest. */
const POLL_MEMORY_LIMIT = 200

/**
 * The poll last painted by the poll actions, per chat and message.
 *
 * A visible poll's heartbeat is a server read, so it answers with the same poll
 * every ten seconds; the card must not repaint for that. Only values this path
 * paints are recorded — a pushed update is not, because the renderer may have no
 * card for it (the comment panel's thread page is cached for the session), and
 * the next heartbeat has to repair that card rather than stay silent. Keyed by the
 * mapper so sign-out/sign-in starts clean (the mapper is created once per adapter).
 */
const pollMemory = new WeakMap<object, Map<string, string>>()

interface PollMemoryOwner {
  mapper: MapperContext
}

function memoryOf(owner: PollMemoryOwner): Map<string, string> {
  let memory = pollMemory.get(owner.mapper)
  if (memory === undefined) {
    memory = new Map()
    pollMemory.set(owner.mapper, memory)
  }
  return memory
}

/** Records the poll the renderer is about to be given; true means the value is new. */
function rememberPoll(
  owner: PollMemoryOwner,
  chatId: number,
  messageId: number,
  poll: Poll,
): boolean {
  const memory = memoryOf(owner)
  const key = `${chatId}:${messageId}`
  const json = JSON.stringify(poll)
  if (memory.get(key) === json) return false
  // Re-insert so the oldest entry is always the first one the cap drops.
  memory.delete(key)
  memory.set(key, json)
  if (memory.size > POLL_MEMORY_LIMIT) {
    const oldest = memory.keys().next().value
    if (oldest !== undefined) memory.delete(oldest)
  }
  return true
}

/**
 * Changes this account's answer to a poll (design doc §9.10).
 *
 * TDLib addresses the poll through its message, and option_ids are positions in
 * poll.options — not the option id strings that newer polls also carry. An empty
 * list retracts the answer.
 *
 * A vote is not echoed by the command: setPollAnswer answers Ok and the changed
 * poll arrives later as updateMessageContent. That update re-reads the message
 * and swallowed a failure there, so a vote that had landed could leave the card
 * on its old counts — the reader sees "nothing happened" and clicks again. The
 * message is therefore read back here, with the answer to the call that caused
 * it; the later update is a no-op replace.
 */
export async function votePoll(
  deps: ActionDeps,
  input: InvokeRequest<'messages:vote'>,
): Promise<void> {
  try {
    await answer(deps, {
      _: 'setPollAnswer',
      chat_id: input.chatId,
      message_id: input.messageId,
      option_ids: input.optionIds,
    })
  } catch (error) {
    // A refusal means this copy is stale (voted elsewhere, quiz settled): re-read
    // it before reporting, so the card cannot stay votable after the server said no.
    await refreshPollMessage(deps, input, true)
    if (isChangeRefusal(error)) throw new AppError('poll_answered', '已经投过票，不能再改')
    throw error
  }
  await refreshPollMessage(deps, input, true)
}

/** Adds an answer option when the poll allows it (messagePoll.can_add_option). */
export async function addPollOption(
  deps: ActionDeps,
  input: InvokeRequest<'messages:addPollOption'>,
): Promise<void> {
  await answer(deps, {
    _: 'addPollOption',
    chat_id: input.chatId,
    message_id: input.messageId,
    // `media` is a nullable class field: TDLib's JSON parser wants it present.
    option: { _: 'inputPollOption', text: formattedText(input.text), media: null },
  })
  await refreshPollMessage(deps, input, true)
}

/**
 * The visible-poll heartbeat.
 *
 * TDLib refreshes a poll's results itself only while its message is registered in
 * a dialog's message list, and only every 42–60 seconds; a comment thread's rows
 * belong to the discussion group, which is not the open chat, so TDLib unloads
 * them (and the registration) while the thread stays on screen. `getMessage` then
 * answers from the local store and the card never moves. A thread anchor makes
 * this read go through `getMessageThreadHistory`: a server request that re-inserts
 * the row, re-registers its poll and returns today's counters in the same answer.
 * The result is painted as a `poll` patch, so a read that changes nothing stays
 * silent (see `rememberPoll`).
 */
export async function refreshPoll(
  deps: ActionDeps,
  input: InvokeRequest<'messages:refreshPoll'>,
): Promise<boolean> {
  return refreshPollMessage(deps, input, false)
}

/**
 * One poll write, with a refusal left in the log.
 *
 * The renderer does show the AppError in its error bar, but that bar is easy to
 * miss and carries only the mapped message. A vote the server refuses is a
 * TDLib-level fact, and `.cache/app.log` is where the next session looks for it.
 */
async function answer(deps: ActionDeps, method: TdObject): Promise<void> {
  try {
    await deps.invoke(method)
  } catch (error) {
    deps.logger.warn(`poll: ${String(method._)} was refused`, error)
    throw error
  }
}

/**
 * TDLib's refusals for an answer this poll will not take back: the poll answered
 * once has its revoting disabled (PollManager: "Can't retract vote in the poll" /
 * "Can't revote in the poll"), and a quiz is final ("Can't revote in a quiz").
 * The renderer turns this into the card's own 不能修改 line, not the error bar.
 */
function isChangeRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /can't retract vote in the poll|can't revote in the poll|can't revote in a quiz/i.test(
    message,
  )
}

/** Reads the server copy; vote writes announce it, heartbeats only paint a change. */
async function refreshPollMessage(
  deps: ActionDeps,
  input: { chatId: number; messageId: number; thread?: { chatId: number; messageId: number } },
  announce: boolean,
): Promise<boolean> {
  try {
    const raw = await deps.invoke({
      _: 'getMessage',
      chat_id: input.chatId,
      message_id: input.messageId,
    })
    if (!raw || raw._ === 'error') return false
    // A thread row must come from the server; the local read above only proves the
    // message exists. Without an anchor this stays the local touch it always was.
    const fresh = input.thread
      ? await threadCopy(deps, input.thread, input.messageId)
      : null
    const message = await mapMessage(deps.mapper, input.chatId, fresh ?? raw)
    if (!message.poll) return false
    if (announce) {
      rememberPoll(deps, input.chatId, input.messageId, message.poll)
      deps.emit({ type: 'messages', chatId: input.chatId, ops: [{ op: 'replace', message }] })
      return true
    }
    if (fresh !== null && rememberPoll(deps, input.chatId, input.messageId, message.poll)) {
      deps.emit({
        type: 'messages',
        chatId: input.chatId,
        ops: [
          {
            op: 'poll',
            chatId: input.chatId,
            messageId: input.messageId,
            poll: message.poll,
          },
        ],
      })
    }
    return true
  } catch (error) {
    // The update that normally carries the new poll can still arrive.
    deps.logger.warn('poll: could not read the message back', error)
    return false
  }
}

/**
 * The row as the server has it, read through its comment thread.
 *
 * `from_message_id` is exclusive — the pager in `comments()` filters the cursor row
 * out for that reason — so `messageId + 1` makes the requested message the newest
 * row of the answer; TDLib may return more than `limit`, so the id still picks it.
 * Passing the id unchanged asks for older comments and usually answers with an
 * empty page (which TDLib reports as "Receive messages in an unexpected chat" for
 * a channel thread), leaving `fresh` null and the card unpainted.
 */
async function threadCopy(
  deps: Pick<ActionDeps, 'invoke' | 'logger'>,
  thread: { chatId: number; messageId: number },
  messageId: number,
): Promise<TdObject | null> {
  try {
    const page = await deps.invoke({
      _: 'getMessageThreadHistory',
      chat_id: thread.chatId,
      message_id: thread.messageId,
      from_message_id: messageId + 1,
      offset: 0,
      limit: 1,
    })
    const fresh = asArray<TdObject>(page?.messages).find(
      (message) => Number(message?.id) === messageId,
    )
    return fresh ?? null
  } catch (error) {
    // A post without a readable thread (or a deleted row) keeps the local copy.
    deps.logger.warn('poll: could not read the comment thread', error)
    return null
  }
}
