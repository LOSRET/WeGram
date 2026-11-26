import { AppError } from '@wegram/protocol'
import type { CommentContent, CommentSendQuery, Message } from '@wegram/protocol'

import type { CommentAccess, CommentJoinResult, CommentTarget } from '../../adapter'
import { resolveCommentAccess, type ChatMemberKind } from '../../comment-access'
import { asArray } from '../json'
import type { TdObject } from '../client'
import { mapMessage } from '../map/message'
import type { ActionDeps } from './deps'
import { inputText, sendAndMap } from './message-input'
import { mediaContent, stickerContent } from './send'

/** The protocol caps a page at 100; TDLib may answer with fewer by itself. */
const MAX_COMMENTS = 100

/**
 * One page of a message's comment thread (design doc §9.8).
 *
 * TDLib resolves the thread on its own: a channel post is looked up through the
 * channel's linked discussion group, while a post inside that group owns the
 * thread directly. `from_message_id` is the paging cursor — the oldest comment
 * already on screen — and the request is exclusive, like `getChatHistory`.
 *
 * The interface answers newest first; the transcript convention (and there-
 * fore the renderer's) is ascending, so the page is sorted before mapping.
 */
export async function comments(
  deps: ActionDeps,
  input: { chatId: number; messageId: number; fromMessageId?: number; limit: number },
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(input.limit, 1), MAX_COMMENTS)
  const response = await deps.invoke({
    _: 'getMessageThreadHistory',
    chat_id: input.chatId,
    message_id: input.messageId,
    from_message_id: input.fromMessageId ?? 0,
    offset: 0,
    limit,
  })
  const raw: TdObject[] = asArray(response?.messages)
  const fresh = raw.filter((message) => {
    const id = Number(message.id)
    if (!Number.isFinite(id)) return false
    return input.fromMessageId === undefined || id < input.fromMessageId
  })
  const ordered = [...fresh].sort((a, b) => Number(a.id) - Number(b.id))
  const mapped = await Promise.all(
    ordered.map((message) =>
      mapMessage(deps.mapper, Number(message.chat_id ?? input.chatId), message),
    ),
  )
  // A short answer is the end of the thread: there is no local-cache quirk here
  // (the top-up dance in `history` exists because of `getChatHistory`).
  return { messages: mapped, hasMore: raw.length >= limit }
}
/**
 * Posts a comment on a message (design doc §9.8).
 *
 * TDLib keeps a channel post's comments in the linked discussion supergroup, so
 * the chat to send to is not the one the button was pressed in: `getMessageThread`
 * answers both that chat and the thread's root id in it. A comment is a reply to
 * the root unless the reader is answering another comment.
 *
 * The comment box is the chat composer's card, so the payload is whatever that
 * card produced: text, a sticker, or a local photo/document. Text clears the
 * thread's draft; media and stickers carry TDLib's `options` field, as they do
 * in a chat.
 */
export async function sendComment(
  deps: ActionDeps,
  input: CommentSendQuery,
): Promise<{ message: Message }> {
  const { chatId: discussionChatId, rootId } = await resolveThread(deps, input, {
    requireRoot: true,
  })
  const content = await commentContent(deps, input.content)
  const { message } = await sendAndMap(deps, discussionChatId, content, {
    replyTo: input.replyTo ?? rootId,
    ...(input.content.kind === 'text' ? {} : { options: null }),
  })
  return { message }
}

/** The `sendMessage` body for one comment payload. */
async function commentContent(deps: ActionDeps, content: CommentContent): Promise<TdObject> {
  switch (content.kind) {
    case 'text':
      return inputText(content.text, true)
    case 'sticker':
      return stickerContent(deps, content.fileId)
    case 'media':
      return mediaContent({
        filePath: content.filePath,
        kind: content.mediaKind,
        ...(content.caption === undefined ? {} : { caption: content.caption }),
      })
  }
}
/** Discussion chat + thread root of a message, or a readable failure. */
async function resolveThread(
  deps: Pick<ActionDeps, 'invoke'>,
  input: CommentTarget,
  /** Sending needs the thread root (it is the reply target); reading does not. */
  options: { requireRoot?: boolean } = {},
): Promise<{ chatId: number; rootId: number; comments?: number }> {
  const thread = await deps.invoke({
    _: 'getMessageThread',
    chat_id: input.chatId,
    message_id: input.messageId,
  })
  const chatId = Number(thread?.chat_id ?? 0)
  const rootId = Number(thread?.message_thread_id ?? 0)
  if (!chatId) throw new AppError('not_implemented', '这个帖子还没有讨论群组，不能评论')
  if (options.requireRoot && !rootId) {
    throw new AppError('not_implemented', '这个帖子还没有讨论群组，不能评论')
  }
  // `getMessageThread` is a server answer, and its reply_info is the live count;
  // the post row in the transcript may have been read much earlier. A forum can
  // answer without reply_info, so the field stays absent rather than guessed.
  const replyCount = Number(thread?.reply_info?.reply_count)
  const comments = Number.isFinite(replyCount) && replyCount >= 0 ? replyCount : undefined
  return { chatId, rootId, ...(comments === undefined ? {} : { comments }) }
}

function memberKindOf(status: TdObject | undefined): ChatMemberKind {
  switch (status?._) {
    case 'chatMemberStatusCreator':
      return 'creator'
    case 'chatMemberStatusAdministrator':
      return 'administrator'
    case 'chatMemberStatusMember':
      return 'member'
    case 'chatMemberStatusRestricted':
      // A restricted non-member is a non-member for this rule: joining is the
      // next step, not a permission check.
      return status.is_member ? 'restricted' : 'left'
    case 'chatMemberStatusBanned':
      return 'banned'
    default:
      return 'left'
  }
}

/**
 * Whether the composer may post here (design doc §9.8). Mirrors the official
 * client: the answer comes from the discussion group's membership status, the
 * join-to-send flag and the permissions TDLib already has — no server call asks
 * "can I comment".
 */
export async function commentInfo(deps: ActionDeps, input: CommentTarget): Promise<CommentAccess> {
  const { chatId, comments } = await resolveThread(deps, input)
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const supergroupId = chat?.type?._ === 'chatTypeSupergroup' ? Number(chat.type.supergroup_id) : 0
  if (!supergroupId) {
    return withThreadCount(
      deps,
      input,
      comments,
      resolveCommentAccess({
        memberKind: 'unknown',
        restrictedIsMember: false,
        defaultCanSend: false,
        restrictedCanSend: false,
        hasPublicUsername: false,
        joinToSend: true,
        joinByRequest: false,
        isBroadcast: false,
        slowModeSeconds: 0,
      }),
    )
  }
  const supergroup = await deps.invoke({ _: 'getSupergroup', supergroup_id: supergroupId })
  const status: TdObject | undefined = supergroup?.status
  const usernames = supergroup?.usernames
  const hasPublicUsername = Boolean(
    usernames &&
    ((usernames.active_usernames?.length ?? 0) > 0 || Boolean(usernames.editable_username)),
  )
  const slowModeSeconds = supergroup?.is_slow_mode_enabled
    ? await slowModeLeft(deps, supergroupId)
    : 0
  return withThreadCount(
    deps,
    input,
    comments,
    resolveCommentAccess({
      memberKind: memberKindOf(status),
      restrictedIsMember: Boolean(status?.is_member),
      defaultCanSend: Boolean(chat?.permissions?.can_send_basic_messages),
      restrictedCanSend: Boolean(status?.permissions?.can_send_basic_messages),
      hasPublicUsername,
      joinToSend: Boolean(supergroup?.join_to_send_messages),
      joinByRequest: Boolean(supergroup?.join_by_request),
      isBroadcast: Boolean(supergroup?.is_broadcast_group),
      slowModeSeconds,
    }),
  )
}

/**
 * Adds the thread's live count to the access answer.
 *
 * The panel's header and the post's 评论 bar both read `interaction.comments`, and
 * the transcript's copy is only as fresh as the last interaction update. The
 * thread read above is a server answer, so it patches the post through the normal
 * op stream as well — the official client shows the same count on both.
 */
function withThreadCount(
  deps: Pick<ActionDeps, 'emit'>,
  input: CommentTarget,
  comments: number | undefined,
  access: CommentAccess,
): CommentAccess {
  if (comments === undefined) return access
  deps.emit({
    type: 'messages',
    chatId: input.chatId,
    ops: [
      {
        op: 'interaction',
        chatId: input.chatId,
        messageId: input.messageId,
        interaction: { comments, canOpen: true },
      },
    ],
  })
  return { ...access, comments }
}

async function slowModeLeft(
  deps: Pick<ActionDeps, 'invoke'>,
  supergroupId: number,
): Promise<number> {
  try {
    const full = await deps.invoke({ _: 'getSupergroupFullInfo', supergroup_id: supergroupId })
    return Math.max(0, Number(full?.slow_mode_delay_expires_in ?? 0))
  } catch {
    // Full info is optional here: a failed lookup must not block commenting.
    return 0
  }
}

export async function joinCommentGroup(
  deps: Pick<ActionDeps, 'invoke'>,
  input: CommentTarget,
): Promise<CommentJoinResult> {
  const { chatId } = await resolveThread(deps, input)
  const result = await deps.invoke({ _: 'joinChat', chat_id: chatId })
  switch (result?._) {
    case 'chatJoinResultSuccess':
      return { joined: true, requestSent: false }
    case 'chatJoinResultRequestSent':
      return { joined: false, requestSent: true }
    case 'chatJoinResultGuardBotApprovalRequired':
      throw new AppError('not_implemented', '这个讨论组需要通过机器人验证才能加入')
    default:
      throw new AppError('internal', '加入讨论组失败')
  }
}
