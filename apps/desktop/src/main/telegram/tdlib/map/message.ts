import type { Message } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapContent, serviceText, SERVICE_CONTENT_TYPES } from './content'
import type { MapperContext } from './context'

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
  const content = raw.content ?? {}
  const mapped = mapContent(content)
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
    ...(raw.reply_to?.message_id ? { replyToId: raw.reply_to.message_id } : {}),
    ...(raw.edit_date ? { edited: true } : {}),
  }
}
