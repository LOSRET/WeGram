import { buildCommentThread } from '@wegram/mock-fixtures'
import { composeCommentAccess, pageOlder } from '@wegram/mock-session'
import { AppError } from '@wegram/protocol'
import type { Message } from '@wegram/protocol'

import type {
  AdapterEvent,
  CommentAccess,
  CommentJoinResult,
  CommentPage,
  CommentQuery,
  CommentSendQuery,
  CommentTarget,
} from '@wegram/adapter-contract'
import type { Fixture } from './constants'
import { simulateTransfer } from './effects'
import { buildMediaMessage, buildStickerMessage, type MockSendDeps } from './media'
import { outgoingMessage } from './transcript'

/**
 * Comment threads for the mock fixtures (design doc §9.8).
 *
 * The real adapter gets these from TDLib's message threads: a channel post's
 * comments live in its linked discussion group. The mock keeps them apart from
 * the transcript on purpose — exactly like the real data — so the renderer's
 * "open the thread" path is exercised without a second chat.
 */

/**
 * One mock thread: `count` comments on `messageId`, oldest first.
 *
 * The authors, bodies and id formula live in `@wegram/mock-fixtures` so the
 * browser preview's threads are the same ones; only the clock is this process's.
 */
export function mockThread(
  chatId: number,
  messageId: number,
  count: number,
  minutesAgo: number,
): Message[] {
  return buildCommentThread({
    chatId,
    messageId,
    count,
    minutesAgo,
    now: () => Math.floor(Date.now() / 1000),
  })
}

/**
 * One page of a thread, newest last, mirroring `messages:comments`: the cursor
 * is exclusive, and `hasMore` means older comments are still below the page.
 */
export function pageThread(
  thread: Message[] | undefined,
  input: { fromMessageId?: number; limit: number },
): { messages: Message[]; hasMore: boolean } {
  const page = pageOlder(thread ?? [], input.fromMessageId, input.limit)
  return { messages: page.messages.map((message) => ({ ...message })), hasMore: page.hasMore }
}
/** One page of a fixture's thread, with the unknown-chat guard the adapter relies on. */
export function commentsOf(fixtures: Map<number, Fixture>, input: CommentQuery): CommentPage {
  const fixture = fixtures.get(input.chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${input.chatId}`)
  return pageThread(fixture.comments?.[input.messageId], input)
}
/**
 * The mock's send path: append to the fixture thread and patch the parent's
 * counter, exactly the way the adapter emits it for `updateMessageInteractionInfo`.
 *
 * A comment is whatever the (reused) composer card produced: text, a sticker or
 * a local file, built by the same helpers a chat's sends use (§9.8).
 */
export async function postComment(
  deps: {
    fixtures: Map<number, Fixture>
    emit: (event: AdapterEvent) => void
    /** Lazy: the adapter's assets do not exist while its fields initialise. */
    sendDeps: () => MockSendDeps
  },
  input: CommentSendQuery,
): Promise<{ message: Message }> {
  const fixture = deps.fixtures.get(input.chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${input.chatId}`)
  const thread = fixture.comments?.[input.messageId]
  if (!thread) throw new AppError('not_implemented', '这个帖子还没有讨论群组，不能评论')
  const id = thread.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const built = await buildComment(deps.sendDeps, input, id)
  thread.push(built.message)
  const parent = fixture.messages.find((item) => item.id === input.messageId)
  const interaction = { ...parent?.interaction, comments: thread.length, canOpen: true }
  if (parent) parent.interaction = interaction
  deps.emit({
    type: 'messages',
    chatId: input.chatId,
    ops: [{ op: 'interaction', chatId: input.chatId, messageId: input.messageId, interaction }],
  })
  // A posted file uploads asynchronously, like TDLib does.
  if (built.upload) {
    void simulateTransfer(
      { files: deps.sendDeps().assets.files, emit: deps.emit },
      built.upload.fileId,
      built.upload.size,
      true,
    )
  }
  return { message: built.message }
}

/** The row one posted payload becomes, and the upload it starts. */
async function buildComment(
  sendDeps: () => MockSendDeps,
  input: CommentSendQuery,
  id: number,
): Promise<{ message: Message; upload?: { fileId: number; size: number } }> {
  const chatId = input.chatId
  switch (input.content.kind) {
    case 'text':
      return {
        message: outgoingMessage({
          id,
          chatId,
          kind: 'text',
          text: input.content.text,
          replyTo: input.replyTo,
        }),
      }
    case 'sticker':
      return {
        message: buildStickerMessage(sendDeps(), {
          id,
          chatId,
          fileId: input.content.fileId,
          replyTo: input.replyTo,
        }).message,
      }
    case 'media': {
      const built = await buildMediaMessage(sendDeps(), {
        id,
        chatId,
        filePath: input.content.filePath,
        kind: input.content.mediaKind,
        ...(input.content.caption === undefined ? {} : { caption: input.content.caption }),
        replyTo: input.replyTo,
      })
      return { message: built.message, upload: { fileId: built.fileId, size: built.size } }
    }
  }
}
/** The mock's stand-in for the membership/permission rule of comment-access.ts. */
export function commentAccessOf(
  fixtures: Map<number, Fixture>,
  input: CommentTarget,
): CommentAccess {
  const fixture = fixtures.get(input.chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${input.chatId}`)
  if (!fixture.comments?.[input.messageId]) {
    throw new AppError('not_implemented', '这个帖子还没有讨论群组，不能评论')
  }
  return composeCommentAccess(fixture.commentAccess)
}

/** Joining the mock group: a request group only records the request. */
export function joinGroupIn(
  fixtures: Map<number, Fixture>,
  input: CommentTarget,
): CommentJoinResult {
  const access = commentAccessOf(fixtures, input)
  if (access.joinByRequest) return { joined: false, requestSent: true }
  const fixture = fixtures.get(input.chatId)
  if (fixture) fixture.commentAccess = { ...fixture.commentAccess, joined: true, canComment: true }
  return { joined: true, requestSent: false }
}
/**
 * The mock's whole comment API in one object, so the adapter class stays thin
 * (`mock/index.ts` is at its line budget).
 */
export function createMockComments(
  fixtures: Map<number, Fixture>,
  emit: (event: AdapterEvent) => void,
  sendDeps: () => MockSendDeps,
) {
  return {
    comments: async (input: CommentQuery): Promise<CommentPage> => commentsOf(fixtures, input),
    info: async (input: CommentTarget): Promise<CommentAccess> => commentAccessOf(fixtures, input),
    join: async (input: CommentTarget): Promise<CommentJoinResult> => joinGroupIn(fixtures, input),
    send: async (input: CommentSendQuery): Promise<{ message: Message }> =>
      postComment({ fixtures, emit, sendDeps }, input),
  }
}
