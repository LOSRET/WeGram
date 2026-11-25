import { AppError } from '@wegram/protocol'
import type { Message } from '@wegram/protocol'

import { probeImageSize } from '../../../media/image-size'
import { probeVideoMeta } from '../../../media/video-meta'
import type { MediaKind } from '../../adapter'
import type { TdObject } from '../client'
import { asArray } from '../json'
import { mapMessage } from '../map/message'
import type { ActionDeps } from './deps'
import { history } from './history'
import { formattedText, inputText, replyTo, sendAndMap, topicRef } from './message-input'

export async function sendText(
  deps: ActionDeps,
  input: { chatId: number; topicId?: number; text: string; replyTo?: number },
): Promise<{ localId: string; message: Message }> {
  return sendAndMap(deps, input.chatId, inputText(input.text, true), {
    replyTo: input.replyTo,
    topicId: input.topicId,
  })
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

/**
 * 编辑说明: rewrite a media message's caption.
 *
 * A caption belongs to the *content* (photo, video, animation, document, voice),
 * so this is `editMessageCaption`, not an edit of the message text. TDLib wants
 * `show_caption_above_media` on every call and the content type is the only place
 * that flag lives for the ones that have it, so the current row is read first:
 * editing a caption must not move it from above the picture to below it. The
 * other content types have no such flag and default to below.
 */
export async function editCaption(
  deps: ActionDeps,
  input: { chatId: number; messageId: number; caption: string },
): Promise<Message> {
  const current = await deps.invoke({
    _: 'getMessage',
    chat_id: input.chatId,
    message_id: input.messageId,
  })
  const above = current?.content?.show_caption_above_media === true
  const caption = input.caption.trim()
  const response = await deps.invoke({
    _: 'editMessageCaption',
    chat_id: input.chatId,
    message_id: input.messageId,
    reply_markup: null,
    caption: caption.length > 0 ? formattedText(input.caption) : null,
    show_caption_above_media: above,
  })
  return mapMessage(deps.mapper, input.chatId, response)
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

/**
 * 取消上传: remove a message that is still being uploaded.
 *
 * TDLib 1.8.70 has no "cancel this send" call and no `cancelUploadFile`; deleting
 * a pending message is the supported path, and MessagesManager cancels the file's
 * upload as part of it. `revoke: false` on purpose: nothing was delivered, and a
 * revoke would demand a server round trip for a message that does not exist yet.
 */
export async function cancelSend(
  deps: ActionDeps,
  input: { chatId: number; messageId: number },
): Promise<void> {
  await deps.invoke({
    _: 'deleteMessages',
    chat_id: input.chatId,
    message_ids: [input.messageId],
    revoke: false,
  })
}

export async function forwardMessages(
  deps: ActionDeps,
  input: { fromChatId: number; messageIds: number[]; toChatId: number; toTopicId?: number },
): Promise<void> {
  await deps.invoke({
    _: 'forwardMessages',
    chat_id: input.toChatId,
    topic_id: topicRef(input.toTopicId),
    from_chat_id: input.fromChatId,
    message_ids: input.messageIds,
    options: null,
  })
}

export async function markRead(
  deps: ActionDeps,
  input: { chatId: number; topicId?: number; upToMessageId: number },
): Promise<void> {
  await deps.invoke({
    _: 'viewMessages',
    chat_id: input.chatId,
    message_ids: [input.upToMessageId],
    // 话题内已读 (design doc §9.12): `viewMessages` has no topic field in TDLib
    // 1.8.70; the read *source* is what tells it the ids belong to a topic.
    ...(input.topicId
      ? { source: { _: 'messageSourceForumTopicHistory' } }
      : {}),
    force_read: true,
  })
}

/**
 * 对方正在输入: one TDLib chat action.
 *
 * Deliberately never throws. Typing is ambient presence, not a command the reader
 * asked for: a failed `sendChatAction` (offline, a chat that no longer exists)
 * must not raise the error bar over the composer. The renderer throttles the
 * repeat rate, so this is one call per few keystrokes-seconds, not per keystroke.
 */
export async function sendTyping(
  deps: Pick<ActionDeps, 'invoke' | 'logger'>,
  chatId: number,
  typing: boolean,
  // A voice note is a different chat action ("recording a voice message"); the
  // renderer asks for it while the hold-to-record gesture is live.
  action: 'typing' | 'recording' = 'typing',
  /** The topic the reader is composing in; absent means the chat's General. */
  topicId?: number,
): Promise<void> {
  try {
    await deps.invoke({
      _: 'sendChatAction',
      chat_id: chatId,
      topic_id: topicRef(topicId),
      business_connection_id: '',
      action: {
        _: !typing
          ? 'chatActionCancel'
          : action === 'recording'
            ? 'chatActionRecordingVoiceNote'
            : 'chatActionTyping',
      },
    })
  } catch (error) {
    deps.logger.warn(
      `typing action for chat ${chatId} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 转文字: ask TDLib to recognise a voice note's speech (`recognizeSpeech`).
 *
 * `recognizeSpeech` answers `Ok` at once; the transcript (partial text, then the
 * final one) arrives as a change to the message content, which the update handler
 * already remaps into a `replace` op. A refusal (no Premium/trial left, wrong
 * message kind) is a real error the reader should see, so it is not swallowed —
 * the button is only offered when `messageProperties.can_recognize_speech` is set.
 */
export async function transcribeMessage(
  deps: Pick<ActionDeps, 'invoke'>,
  input: { chatId: number; messageId: number },
): Promise<void> {
  await deps.invoke({
    _: 'recognizeSpeech',
    chat_id: input.chatId,
    message_id: input.messageId,
  })
}

/**
 * 重试 a failed message (`resendMessages`).
 *
 * TDLib answers with the messages it retried, each still `pending`; the final
 * state arrives later as `updateMessageSendSucceeded` / `updateMessageSendFailed`.
 * The answer is applied as a full replacement so the row leaves 未发送 at once.
 */
export async function resendMessages(
  deps: ActionDeps,
  chatId: number,
  messageIds: number[],
): Promise<void> {
  const response = await deps.invoke({
    _: 'resendMessages',
    chat_id: chatId,
    message_ids: messageIds,
    quote: null,
    paid_message_star_count: 0,
  })
  const messages = asArray<TdObject>(response?.messages)
  for (const raw of messages) {
    const message = await mapMessage(deps.mapper, chatId, raw)
    deps.emit({ type: 'messages', chatId, ops: [{ op: 'replace', message }] })
  }
}

/**
 * The `inputMessagePhoto` / `inputMessageVideo` / `inputMessageDocument` body for
 * a local file.
 *
 * Photos go through `inputMessagePhoto` so the server builds the usual size
 * ladder; a video becomes a playable video message through `inputMessageVideo`,
 * whose dimensions and duration TDLib wants and which main reads from the MP4
 * itself (`media/video-meta.ts`); everything else is a document. A picture or a
 * clip this client cannot measure falls back to a document instead of producing
 * a broken bubble — that is the same rule, one fallback per kind.
 *
 * Shared with the comment thread (§9.8): a comment carries the same file into
 * the discussion group.
 */
export async function mediaContent(input: {
  filePath: string
  kind: MediaKind
  caption?: string
}): Promise<TdObject> {
  if (input.kind === 'video') {
    const meta = await probeVideoMeta(input.filePath)
    if (meta) {
      return {
        _: 'inputMessageVideo',
        video: {
          _: 'inputVideo',
          video: { _: 'inputFileLocal', path: input.filePath },
          thumbnail: null,
          cover: null,
          start_timestamp: 0,
          added_sticker_file_ids: [],
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          supports_streaming: true,
        },
        caption: formattedText(input.caption),
        show_caption_above_media: false,
        self_destruct_type: null,
        has_spoiler: false,
      }
    }
  }
  const size = input.kind === 'photo' ? await probeImageSize(input.filePath) : null
  return input.kind === 'photo' && size
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
}

/**
 * The `inputMessageVoiceNote` body for a recorded clip (语音消息).
 *
 * TDLib accepts a voice note only as Opus inside an OGG container; an MP3 or an
 * M4A is stored as an ordinary *audio* message and would draw the file bubble.
 * The renderer produces exactly that container (WebCodecs Opus packets muxed by
 * `renderer/lib/voice/oggOpus.ts`), main writes it to a temporary file, and
 * TDLib uploads it from there.
 *
 * `waveform` is deliberately empty: the scheme says "5-bit format" without
 * defining the packing, so the audit's advice (start with an empty waveform) is
 * what we do until a real client confirms the bytes. The bubble's wave is
 * decorative anyway.
 */
export function voiceContent(input: { filePath: string; duration: number }): TdObject {
  return {
    _: 'inputMessageVoiceNote',
    voice_note: {
      _: 'inputVoiceNote',
      voice_note: { _: 'inputFileLocal', path: input.filePath },
      duration: input.duration,
      waveform: '',
    },
    caption: formattedText(''),
    self_destruct_type: null,
  }
}

/** Sends one recorded voice note; the row comes back mapped like any other send. */
export async function sendVoice(
  deps: ActionDeps,
  input: {
    chatId: number
    topicId?: number
    filePath: string
    duration: number
    replyTo?: number
  },
): Promise<{ localId: string; message: Message }> {
  return sendAndMap(deps, input.chatId, voiceContent(input), {
    replyTo: input.replyTo,
    topicId: input.topicId,
    options: null,
  })
}

/** Sends a local file into a chat (design doc §1: media upload). */
export async function sendMedia(
  deps: ActionDeps,
  input: {
    chatId: number
    topicId?: number
    filePath: string
    kind: MediaKind
    caption?: string
    replyTo?: number
  },
): Promise<{ localId: string; message: Message }> {
  return sendAndMap(deps, input.chatId, await mediaContent(input), {
    replyTo: input.replyTo,
    topicId: input.topicId,
    options: null,
  })
}

/**
 * 相册: several local photos and videos as one Telegram album
 * (`sendMessageAlbum`).
 *
 * Telegram has no "message with several media": an album is 2–10 messages
 * sharing `media_album_id`, sent in one call and answered as `Messages`. Every
 * answer is mapped like a normal send, so the rows carry the album id and the
 * transcript folds them back into one bubble (design doc §8.6). Photos and videos
 * can be mixed; the content builders are the single-send ones, so an album video
 * is the same `inputMessageVideo`.
 *
 * TDLib requires one shared `show_caption_above_media` across the group, which
 * both builders fix to false, so that constraint cannot be violated by a caller.
 *
 * A video whose metadata cannot be read would fall back to a *document*, and a
 * document row breaks the transcript's fold (and its album key would collide with
 * the photo rows). Such a batch is therefore sent as separate messages, each with
 * the document fallback the single-send path already has.
 */
export async function sendAlbum(
  deps: ActionDeps,
  input: {
    chatId: number
    topicId?: number
    items: Array<{ filePath: string; kind: 'photo' | 'video'; caption?: string }>
    replyTo?: number
  },
): Promise<{ localIds: string[]; messages: Message[] }> {
  const contents: TdObject[] = []
  let albumSafe = true
  for (const item of input.items) {
    const content = await mediaContent(item)
    if (item.kind === 'video' && content._ !== 'inputMessageVideo') albumSafe = false
    contents.push(content)
  }
  if (!albumSafe) {
    const messages: Message[] = []
    for (const item of input.items) {
      const sent = await sendMedia(deps, {
        chatId: input.chatId,
        ...(input.topicId === undefined ? {} : { topicId: input.topicId }),
        ...item,
        ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      })
      messages.push(sent.message)
    }
    return { localIds: messages.map((message) => `td-${message.id}`), messages }
  }
  const response = await deps.invoke({
    _: 'sendMessageAlbum',
    chat_id: input.chatId,
    topic_id: topicRef(input.topicId),
    reply_to: replyTo(input.replyTo),
    options: null,
    input_message_contents: contents,
  })
  const messages: Message[] = []
  for (const raw of asArray<TdObject>(response?.messages)) {
    messages.push(await mapMessage(deps.mapper, input.chatId, raw))
  }
  return { localIds: messages.map((message) => `td-${message.id}`), messages }
}

/**
 * The `inputMessageSticker` body for a sticker the picker already knows
 * (design doc §9.4). Shared with the comment thread, like `mediaContent`.
 */
export function stickerContent(deps: Pick<ActionDeps, 'mapper'>, fileId: number): TdObject {
  // Dimensions were cached when the set was mapped; 512 is the sticker default.
  const size = deps.mapper.stickerSizes.get(fileId) ?? { width: 512, height: 512 }
  return {
    _: 'inputMessageSticker',
    sticker: {
      _: 'inputSticker',
      sticker: { _: 'inputFileId', id: fileId },
      thumbnail: null,
      width: size.width,
      height: size.height,
    },
    emoji: '',
  }
}

/** Sends an existing sticker by file id, as the picker does (design doc §9.4). */
export async function sendSticker(
  deps: ActionDeps,
  input: { chatId: number; topicId?: number; fileId: number; replyTo?: number },
): Promise<{ localId: string; message: Message }> {
  return sendAndMap(deps, input.chatId, stickerContent(deps, input.fileId), {
    replyTo: input.replyTo,
    topicId: input.topicId,
    options: null,
  })
}
