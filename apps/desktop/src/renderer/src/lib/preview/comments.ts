import { composeCommentAccess, pageOlder } from '@wegram/mock-session'
import type { EventChannel, Message } from '@wegram/protocol'

import { stickerMedia } from '../stickerMedia'
import { ME, now, PREVIEW_STICKERS, media, previewCommentAccess, previewThreads } from './fixtures'

/**
 * The preview's comment-thread channels (design doc §9.8), split out of
 * `preview/index.ts` when that file reached its size budget.
 *
 * Same rules as the mock adapter: a thread that does not exist cannot be opened or
 * commented; joining flips the fixture's access flags; a posted comment is appended
 * to the thread and the post's `interaction.comments` is patched through
 * `evt:messages`, which the shell applies as an `interaction` op.
 */
export function handlePreviewComments(
  channel:
    | 'messages:comments'
    | 'messages:commentInfo'
    | 'messages:joinCommentGroup'
    | 'messages:sendComment',
  query: Record<string, unknown>,
  messagesByChat: Record<number, Message[]>,
  emit: (channel: EventChannel, payload: unknown) => void,
): unknown {
  const chatId = Number(query.chatId)
  const messageId = Number(query.messageId)
  const key = `${chatId}:${messageId}`

  switch (channel) {
    case 'messages:comments':
      return pageOlder(
        previewThreads[key] ?? [],
        query.fromMessageId as number | undefined,
        Number(query.limit ?? 30),
      )
    case 'messages:commentInfo':
      if (!previewThreads[key]) {
        throw { code: 'not_implemented', message: '这个帖子还没有讨论群组，不能评论' }
      }
      return composeCommentAccess(previewCommentAccess[key])
    case 'messages:joinCommentGroup': {
      const access = previewCommentAccess[key] ?? {}
      if (access.joinByRequest) return { joined: false, requestSent: true }
      previewCommentAccess[key] = { ...access, joined: true, canComment: true }
      return { joined: true, requestSent: false }
    }
    case 'messages:sendComment': {
      const thread = previewThreads[key]
      if (!thread) throw { code: 'not_implemented', message: '这个帖子还没有讨论群组，不能评论' }
      const message = commentRow(
        chatId,
        thread.reduce((max, item) => Math.max(max, item.id), 0) + 1,
        query.content,
      )
      thread.push(message)
      const target = (messagesByChat[chatId] ?? []).find((item) => item.id === messageId)
      if (target) {
        target.interaction = {
          ...target.interaction,
          comments: thread.length,
          canOpen: true,
        }
        emit('evt:messages', {
          chatId,
          ops: [
            {
              op: 'interaction',
              chatId,
              messageId,
              interaction: target.interaction,
            },
          ],
        })
      }
      return { message }
    }
  }
}

/**
 * The row one posted payload becomes, mirroring the mock adapter (§9.8).
 *
 * A comment carries whatever the reused composer card produced; the browser has
 * no native file picker, so only text and stickers reach this point.
 */
function commentRow(chatId: number, id: number, payload: unknown): Message {
  const content =
    payload && typeof payload === 'object'
      ? (payload as { kind?: unknown; fileId?: unknown; text?: unknown })
      : {}
  if (content.kind === 'sticker') {
    const sticker = PREVIEW_STICKERS.find((item) => item.fileId === Number(content.fileId))
    if (!sticker) throw { code: 'internal', message: 'unknown sticker' }
    return {
      id,
      chatId,
      senderId: ME.id,
      senderName: '我',
      outgoing: true,
      date: now(),
      kind: 'sticker',
      text: '',
      media: media(sticker.fileId, stickerMedia(sticker)),
    }
  }
  if (content.kind === 'media') {
    throw { code: 'not_implemented', message: '浏览器预览不能发送本地文件' }
  }
  return {
    id,
    chatId,
    senderId: ME.id,
    senderName: '我',
    outgoing: true,
    date: now(),
    kind: 'text',
    text: String(content.text ?? ''),
  }
}
