import type { Message, MessageInteraction, MessageReaction } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapReplyKeyboard, mapReplyMarkup } from './buttons'
import { mapContent } from './content'
import { serviceText, SERVICE_CONTENT_TYPES } from './service'
import type { MapperContext } from './context'

/**
 * TDLib truncates long rich messages (`richMessage.is_full === false`); the
 * full page is one extra round trip, and half an ad is worse than a slow row.
 * Any failure keeps the excerpt instead of dropping the row.
 */
async function resolveContent(
  ctx: MapperContext,
  chatId: number,
  raw: TdObject,
): Promise<TdObject> {
  const content: TdObject = raw.content ?? {}
  if (content._ !== 'messageRichMessage' || !content.message) return content
  if (content.message.is_full !== false) return content
  const full = await ctx.resolveFullRichMessage?.(chatId, Number(raw.id))
  return full ? { ...content, message: full } : content
}

export async function mapMessage(
  ctx: MapperContext,
  chatId: number,
  raw: TdObject,
): Promise<Message> {
  // `sender_id` is either `messageSenderUser { user_id }` or
  // `messageSenderChat { chat_id }` — channel posts and anonymous admins use
  // the latter. Reading only `user_id` used to leave those as `未知`.
  const senderUserId: number = raw.sender_id?.user_id ?? 0
  const senderChatId: number = raw.sender_id?.chat_id ?? 0
  const senderName = senderUserId
    ? await ctx.resolveUserName(senderUserId)
    : senderChatId
      ? await ctx.resolveChatTitle(senderChatId)
      : '未知'
  // The photo is a bonus, never a reason to hold the message back: a cached one
  // travels with the row, an uncached one is queued and arrives on evt:avatars.
  const senderAvatarUrl = senderUserId
    ? ctx.userAvatarUrls.get(senderUserId)
    : senderChatId
      ? ctx.chatAvatarUrls.get(senderChatId)
      : undefined
  if (senderUserId) ctx.prefetchUserAvatars([senderUserId])
  const content = await resolveContent(ctx, chatId, raw)
  const mapped = mapContent(content)
  const sending = mapSendingState(raw.sending_state)
  // A callback-game button carries no name of its own: the game attached to the
  // message is what the callback query names, so it is read from the content.
  const gameShortName =
    content._ === 'messageGame' && typeof content.game?.short_name === 'string'
      ? content.game.short_name
      : undefined
  const buttons = mapReplyMarkup(raw.reply_markup, gameShortName)
  // A message carries one markup: an inline keyboard under the bubble, or the
  // bot's custom keyboard above the input — never both.
  const replyKeyboard = mapReplyKeyboard(raw.reply_markup)
  const albumId = albumIdOf(raw)
  const topicId = topicIdOf(raw)
  const interaction = mapInteraction(raw)
  const reactions = mapReactions(raw)
  let text = mapped.text
  if (mapped.kind === 'service' && text === '') {
    text = SERVICE_CONTENT_TYPES.has(content._)
      ? await serviceText(content, {
          senderName,
          outgoing: Boolean(raw.is_outgoing),
          resolveUserName: (userId: number) => ctx.resolveUserName(userId),
          resolveChatTitle: (chatId: number) => ctx.resolveChatTitle(chatId),
        })
      : '[暂不支持的消息]'
  }

  return {
    id: raw.id,
    chatId,
    senderId: senderUserId,
    ...(senderChatId ? { senderChatId } : {}),
    senderName,
    ...(senderAvatarUrl ? { senderAvatarUrl } : {}),
    outgoing: Boolean(raw.is_outgoing),
    ...(typeof raw.can_be_saved === 'boolean' ? { canBeSaved: raw.can_be_saved } : {}),
    date: Number(raw.date),
    kind: mapped.kind,
    text,
    ...(mapped.entities.length ? { entities: mapped.entities } : {}),
    ...(mapped.media ? { media: mapped.media } : {}),
    ...(mapped.transcription ? { transcription: mapped.transcription } : {}),
    ...(mapped.rich?.length ? { rich: mapped.rich } : {}),
    ...(mapped.contact ? { contact: mapped.contact } : {}),
    ...(mapped.poll ? { poll: mapped.poll } : {}),
    ...(buttons ? { buttons } : {}),
    ...(replyKeyboard ? { replyKeyboard } : {}),
    ...(albumId ? { albumId } : {}),
    ...(topicId ? { topicId } : {}),
    ...(raw.reply_to?.message_id ? { replyToId: raw.reply_to.message_id } : {}),
    ...(raw.edit_date ? { edited: true } : {}),
    ...sending,
    ...(interaction ? { interaction } : {}),
    ...(reactions ? { reactions } : {}),
  }
}

/**
 * 表情回应 under a message (TDLib `interaction_info.reactions`).
 *
 * The list is TDLib's own order (most reacted first); a reaction is either a
 * standard emoji or a Premium custom emoji whose id is an int64 — carried as a
 * string so it can be looked up as sticker art without rounding. A reaction
 * whose type is neither is dropped instead of drawn as an empty chip.
 */
export function mapReactions(raw: TdObject): MessageReaction[] | undefined {
  const list = raw.interaction_info?.reactions?.reactions
  if (!Array.isArray(list) || list.length === 0) return undefined
  const reactions: MessageReaction[] = []
  for (const entry of list as TdObject[]) {
    const type = entry.reaction_type
    const count = Number(entry.total_count ?? 0)
    if (!Number.isFinite(count) || count <= 0) continue
    const chosen = entry.is_chosen === true ? { chosen: true } : {}
    if (type?._ === 'reactionTypeEmoji' && typeof type.emoji === 'string' && type.emoji) {
      reactions.push({ emoji: type.emoji, count, ...chosen })
    } else if (type?._ === 'reactionTypeCustomEmoji' && type.custom_emoji_id !== undefined) {
      reactions.push({ customEmojiId: String(type.custom_emoji_id), count, ...chosen })
    }
  }
  return reactions.length > 0 ? reactions : undefined
}

/**
 * TDLib `message.sending_state`: absent for a delivered message, 'pending' while
 * the send is in flight, 'failed' when TDLib gave up. The failed branch carries
 * the reason and whether 重试 is allowed (`can_retry`); a failed message with
 * `can_retry: false` is shown as 未发送 with no retry gesture.
 */
function mapSendingState(
  state: TdObject | undefined,
): Pick<Message, 'sendingState' | 'sendError' | 'canRetry'> | Record<string, never> {
  switch (state?._) {
    case 'messageSendingStatePending':
      return { sendingState: 'pending' }
    case 'messageSendingStateFailed': {
      const reason = state.error?.message
      return {
        sendingState: 'failed',
        ...(typeof reason === 'string' && reason ? { sendError: reason } : {}),
        canRetry: Boolean(state.can_retry),
      }
    }
    default:
      return {}
  }
}

/**
 * Views / forwards / comments under a message (design doc §9.8).
 *
 * TDLib only fills reply_info where a comment thread exists — a channel post
 * with a linked discussion group, and the posts inside that group — so this is
 * also the "does this row get a comment bar" test. `reply_info` is there from
 * the moment the thread exists, with `reply_count` 0 until somebody comments,
 * so such a row keeps its interaction: dropping it made "有评论区" posts look
 * like posts without one, and nobody could be the first to comment.
 *
 * `message.properties` does not exist in TDLib 1.8.70 (`getMessageProperties`
 * is a *call*, not a field), so the old `raw.properties?.can_get_message_thread`
 * read was `undefined` on every real message and `canOpen` never arrived. The
 * presence of reply_info is the signal that the thread can be pulled.
 */
export function mapInteraction(raw: TdObject): MessageInteraction | null {
  const info = raw.interaction_info
  if (!info || typeof info !== 'object') return null
  const replyInfo = info.reply_info
  const comments = Number(replyInfo?.reply_count ?? 0)
  const views = Number(info.view_count ?? 0)
  const forwards = Number(info.forward_count ?? 0)
  const hasThread = Boolean(replyInfo && typeof replyInfo === 'object')
  if (!Number.isFinite(comments) || (!comments && !views && !forwards && !hasThread)) return null
  return {
    comments: comments > 0 ? comments : 0,
    ...(views > 0 ? { views } : {}),
    ...(forwards > 0 ? { forwards } : {}),
    ...(hasThread ? { canOpen: true } : {}),
  }
}

/**
 * 话题 the message belongs to (TDLib 1.8.70 `message.topic_id`).
 *
 * Only a forum topic is a topic id the client can navigate to: the same field
 * also carries a message-thread id in an ordinary supergroup and Saved-Messages
 * topics, which look identical in JSON and mean something else. A forum topic
 * arrives as `messageTopicForum`; anything else is left out.
 */
function topicIdOf(raw: TdObject): number | undefined {
  const topic = raw.topic_id
  if (topic?._ !== 'messageTopicForum') return undefined
  const id = Number(topic.forum_topic_id ?? 0)
  return Number.isFinite(id) && id > 0 ? id : undefined
}

/**
 * `media_album_id` is an int64 that TDLib sends as a string, and `'0'` means "not
 * part of an album". Kept as the raw string: the id is a group identity, not a
 * sort key, and `Number()` would lose precision past 2^53.
 */
function albumIdOf(raw: TdObject): string | null {
  const value = raw.media_album_id
  if (value === undefined || value === null) return null
  const albumId = String(value)
  return albumId === '' || albumId === '0' ? null : albumId
}
