import type { Message, MessageInteraction } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapReplyMarkup } from './buttons'
import { mapContent, serviceText, SERVICE_CONTENT_TYPES } from './content'
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
  const buttons = mapReplyMarkup(raw.reply_markup)
  const albumId = albumIdOf(raw)
  const interaction = mapInteraction(raw)
  let text = mapped.text
  if (mapped.kind === 'service' && text === '') {
    text = SERVICE_CONTENT_TYPES.has(content._)
      ? await serviceText(content, {
          senderName,
          outgoing: Boolean(raw.is_outgoing),
          resolveUserName: (userId: number) => ctx.resolveUserName(userId),
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
    date: Number(raw.date),
    kind: mapped.kind,
    text,
    ...(mapped.entities.length ? { entities: mapped.entities } : {}),
    ...(mapped.media ? { media: mapped.media } : {}),
    ...(mapped.rich?.length ? { rich: mapped.rich } : {}),
    ...(mapped.contact ? { contact: mapped.contact } : {}),
    ...(buttons ? { buttons } : {}),
    ...(albumId ? { albumId } : {}),
    ...(raw.reply_to?.message_id ? { replyToId: raw.reply_to.message_id } : {}),
    ...(raw.edit_date ? { edited: true } : {}),
    ...(interaction ? { interaction } : {}),
  }
}

/**
 * Views / forwards / comments under a message (design doc §9.8).
 *
 * TDLib only fills reply_info where a comment thread exists — a channel post
 * with a linked discussion group, and the posts inside that group — so this is
 * also the "does this row get a comment bar" test. An all-zero interaction is
 * dropped instead of carried around as an empty object.
 */
export function mapInteraction(raw: TdObject): MessageInteraction | null {
  const info = raw.interaction_info
  if (!info || typeof info !== 'object') return null
  const comments = Number(info.reply_info?.reply_count ?? 0)
  const views = Number(info.view_count ?? 0)
  const forwards = Number(info.forward_count ?? 0)
  if (!Number.isFinite(comments) || (!comments && !views && !forwards)) return null
  return {
    comments: comments > 0 ? comments : 0,
    ...(views > 0 ? { views } : {}),
    ...(forwards > 0 ? { forwards } : {}),
    // can_get_message_thread is the only reliable "the thread can be opened"
    // signal; a stale counter without it must not offer the pull.
    ...(raw.properties?.can_get_message_thread ? { canOpen: true } : {}),
  }
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
