import { AppError } from '@wegram/protocol'
import type { Message, MessageInteraction } from '@wegram/protocol'

import type {
  AdapterEvent,
  CommentAccess,
  CommentJoinResult,
  CommentPage,
  CommentQuery,
  CommentSendQuery,
  CommentTarget,
} from '../adapter'
import { at, ME, type Fixture } from './constants'

/**
 * Comment threads for the mock fixtures (design doc §9.8).
 *
 * The real adapter gets these from TDLib's message threads: a channel post's
 * comments live in its linked discussion group. The mock keeps them apart from
 * the transcript on purpose — exactly like the real data — so the renderer's
 * "open the thread" path is exercised without a second chat.
 */

const AUTHORS: ReadonlyArray<{ id: number; name: string }> = [
  { id: 4101, name: '小满' },
  { id: 4102, name: '阿星' },
  { id: 4103, name: '林深' },
  { id: 4104, name: '周末不加班' },
  { id: 4105, name: 'Cathy' },
  { id: 4106, name: '老周' },
  { id: 4107, name: '海边的卡夫卡' },
  { id: 4108, name: 'K' },
]

const BODIES: readonly string[] = [
  '这条我先收藏了，晚点对着改。',
  '同问 +1，我也卡在这一步。',
  '已经踩过这个坑了，按你说的顺序调整就好了。',
  '能否再展开讲讲第二种格式？',
  '实测有效，感谢分享。',
  '我把这段转给同事了，正好用得上。',
  '这个思路可以，不过要注意旧版本兼容。',
  '支持，等这个功能很久了。',
  '哈哈哈，这就是我上周的翻车现场。',
  '细节问一下：滚动条是自绘的吗？',
]

/** Ids of mock comments start well above the transcript's, so paging is unambiguous. */
const COMMENT_ID_BASE = 900_000

/**
 * One mock thread: `count` comments on `messageId`, oldest first.
 *
 * `minutesAgo` is when the commented message was posted; comments trail it by
 * two minutes each, always staying newer than the post.
 */
export function mockThread(
  chatId: number,
  messageId: number,
  count: number,
  minutesAgo: number,
): Message[] {
  const messages: Message[] = []
  const start = COMMENT_ID_BASE + messageId * 100
  for (let index = 0; index < count; index += 1) {
    const author = AUTHORS[index % AUTHORS.length] ?? { id: 4101, name: '小满' }
    messages.push({
      id: start + index,
      chatId,
      senderId: author.id,
      senderName: author.name,
      outgoing: false,
      date: at(Math.max(1, minutesAgo - index * 2)),
      kind: 'text',
      text: BODIES[index % BODIES.length] ?? '👍',
    })
  }
  return messages
}

/**
 * One page of a thread, newest last, mirroring `messages:comments`: the cursor
 * is exclusive, and `hasMore` means older comments are still below the page.
 */
export function pageThread(
  thread: Message[] | undefined,
  input: { fromMessageId?: number; limit: number },
): { messages: Message[]; hasMore: boolean } {
  const all = thread ?? []
  const cursor = input.fromMessageId
  const older = cursor === undefined ? all : all.filter((message) => message.id < cursor)
  const page = older.slice(Math.max(0, older.length - input.limit))
  return { messages: page.map((message) => ({ ...message })), hasMore: page.length < older.length }
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
 */
export function postComment(
  deps: { fixtures: Map<number, Fixture>; emit: (event: AdapterEvent) => void },
  input: CommentSendQuery,
): { message: Message } {
  const fixture = deps.fixtures.get(input.chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${input.chatId}`)
  const thread = fixture.comments?.[input.messageId]
  if (!thread) throw new AppError('not_implemented', '这个帖子还没有讨论群组，不能评论')
  const message: Message = {
    id: thread.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    chatId: input.chatId,
    senderId: ME.id,
    senderName: '我',
    outgoing: true,
    date: Math.floor(Date.now() / 1000),
    kind: 'text',
    text: input.text,
    ...(input.replyTo === undefined ? {} : { replyToId: input.replyTo }),
  }
  thread.push(message)
  const parent = fixture.messages.find((item) => item.id === input.messageId)
  const interaction = { ...parent?.interaction, comments: thread.length, canOpen: true }
  if (parent) parent.interaction = interaction
  deps.emit({
    type: 'messages',
    chatId: input.chatId,
    ops: [{ op: 'interaction', chatId: input.chatId, messageId: input.messageId, interaction }],
  })
  return { message }
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
  const access = fixture.commentAccess ?? {}
  const joined = access.joined ?? true
  const canComment = access.canComment ?? joined
  const banned = access.banned ?? false
  return {
    canComment,
    joined,
    canJoin: !joined && !banned && !canComment,
    joinByRequest: access.joinByRequest ?? false,
    slowModeSeconds: canComment ? (access.slowModeSeconds ?? 0) : 0,
  }
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
) {
  return {
    comments: async (input: CommentQuery): Promise<CommentPage> => commentsOf(fixtures, input),
    info: async (input: CommentTarget): Promise<CommentAccess> => commentAccessOf(fixtures, input),
    join: async (input: CommentTarget): Promise<CommentJoinResult> => joinGroupIn(fixtures, input),
    send: async (input: CommentSendQuery): Promise<{ message: Message }> =>
      postComment({ fixtures, emit }, input),
  }
}

/** The comment bar's numbers for a thread, plus optional channel counters. */
export function threadInteraction(
  thread: Message[],
  extra: { views?: number; forwards?: number } = {},
): MessageInteraction {
  return {
    comments: thread.length,
    canOpen: true,
    ...(extra.views ? { views: extra.views } : {}),
    ...(extra.forwards ? { forwards: extra.forwards } : {}),
  }
}
