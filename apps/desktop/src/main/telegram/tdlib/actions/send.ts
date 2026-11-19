import { AppError } from '@wegram/protocol'
import type { Message } from '@wegram/protocol'

import { probeImageSize } from '../../../media/image-size'
import type { MediaKind } from '../../adapter'
import type { ActionDeps } from './deps'
import { history } from './history'
import { formattedText, inputText, sendAndMap } from './message-input'

export async function sendText(
  deps: ActionDeps,
  input: { chatId: number; text: string; replyTo?: number },
): Promise<{ localId: string; message: Message }> {
  return sendAndMap(deps, input.chatId, inputText(input.text, true), { replyTo: input.replyTo })
}

export async function editText(
  deps: ActionDeps,
  input: { chatId: number; messageId: number; text: string },
): Promise<Message> {
  await deps.invoke({
    _: 'editMessageText',
    chat_id: input.chatId,
    message_id: input.messageId,
    input_message_content: inputText(input.text),
  })
  const page = await history(deps, {
    chatId: input.chatId,
    fromMessageId: input.messageId + 1,
    limit: 1,
  })
  const updated = page.messages.find((m) => m.id === input.messageId)
  if (!updated) throw new AppError('internal', `Message ${input.messageId} not found after edit`)
  return updated
}

export async function deleteMessages(
  deps: ActionDeps,
  input: { chatId: number; messageIds: number[]; forBoth: boolean },
): Promise<void> {
  await deps.invoke({
    _: 'deleteMessages',
    chat_id: input.chatId,
    message_ids: input.messageIds,
    revoke: input.forBoth,
  })
}

export async function forwardMessages(
  deps: ActionDeps,
  input: { fromChatId: number; messageIds: number[]; toChatId: number },
): Promise<void> {
  await deps.invoke({
    _: 'forwardMessages',
    chat_id: input.toChatId,
    from_chat_id: input.fromChatId,
    message_ids: input.messageIds,
    options: null,
  })
}

export async function markRead(
  deps: ActionDeps,
  input: { chatId: number; upToMessageId: number },
): Promise<void> {
  await deps.invoke({
    _: 'viewMessages',
    chat_id: input.chatId,
    message_ids: [input.upToMessageId],
    force_read: true,
  })
}

/**
 * Sends a local file. Photos go through `inputMessagePhoto` so the server builds
 * the usual size ladder; everything else is a document. The pixel size must be
 * known before a photo can be sent (TDLib wants it), so an unparsable image falls
 * back to a document instead of producing a broken bubble.
 */
export async function sendMedia(
  deps: ActionDeps,
  input: {
    chatId: number
    filePath: string
    kind: MediaKind
    caption?: string
    replyTo?: number
  },
): Promise<{ localId: string; message: Message }> {
  const size = input.kind === 'photo' ? await probeImageSize(input.filePath) : null
  const content =
    input.kind === 'photo' && size
      ? {
          _: 'inputMessagePhoto',
          photo: {
            _: 'inputPhoto',
            photo: { _: 'inputFileLocal', path: input.filePath },
            thumbnail: null,
            video: null,
            added_sticker_file_ids: [],
            width: size.width,
            height: size.height,
          },
          caption: formattedText(input.caption),
          show_caption_above_media: false,
          self_destruct_type: null,
          has_spoiler: false,
        }
      : {
          _: 'inputMessageDocument',
          document: {
            _: 'inputDocument',
            document: { _: 'inputFileLocal', path: input.filePath },
            thumbnail: null,
            disable_content_type_detection: false,
          },
          caption: formattedText(input.caption),
        }

  return sendAndMap(deps, input.chatId, content, { replyTo: input.replyTo, options: null })
}

/** Sends an existing sticker by file id, as the picker does (design doc §9.4). */
export async function sendSticker(
  deps: ActionDeps,
  input: { chatId: number; fileId: number; replyTo?: number },
): Promise<{ localId: string; message: Message }> {
  // Dimensions were cached when the set was mapped; 512 is the sticker default.
  const size = deps.mapper.stickerSizes.get(input.fileId) ?? { width: 512, height: 512 }
  return sendAndMap(
    deps,
    input.chatId,
    {
      _: 'inputMessageSticker',
      sticker: {
        _: 'inputSticker',
        sticker: { _: 'inputFileId', id: input.fileId },
        thumbnail: null,
        width: size.width,
        height: size.height,
      },
      emoji: '',
    },
    { replyTo: input.replyTo, options: null },
  )
}
