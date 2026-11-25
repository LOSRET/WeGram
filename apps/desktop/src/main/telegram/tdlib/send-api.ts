import type { Message } from '@wegram/protocol'

import type { MediaKind } from '../adapter'
import * as actions from './actions'
import type { ActionDeps } from './actions'

/**
 * The message-domain seam methods — send, edit, delete, forward, read, typing,
 * retry — as one object `TdlibAdapter` binds.
 *
 * Split out of `index.ts` the way `chat-api.ts` and `user-api.ts` were: the
 * adapter class had reached its line budget, and 语音消息's `sendVoiceNote` is one
 * more "call plus its arguments" method that does not need to live there.
 *
 * The deps come in lazily: this object is built before the constructor has
 * finished creating `actionDeps`, and every method reads them on the call.
 */
export function createSendApi(getDeps: () => ActionDeps) {
  return {
    sendText: async (input: {
      chatId: number
      /** 话题内发送; absent means the chat's General topic. */
      topicId?: number
      text: string
      replyTo?: number
    }): Promise<{ localId: string; message: Message }> => actions.sendText(getDeps(), input),

    editText: async (input: {
      chatId: number
      messageId: number
      text: string
    }): Promise<Message> => actions.editText(getDeps(), input),

    /** 编辑说明: a media message's caption; see `actions/editCaption`. */
    editCaption: async (input: {
      chatId: number
      messageId: number
      caption: string
    }): Promise<Message> => actions.editCaption(getDeps(), input),

    deleteMessages: async (input: {
      chatId: number
      messageIds: number[]
      forBoth: boolean
    }): Promise<void> => actions.deleteMessages(getDeps(), input),

    forwardMessages: async (input: {
      fromChatId: number
      messageIds: number[]
      toChatId: number
      /** The destination forum's topic; absent lands in its General topic. */
      toTopicId?: number
    }): Promise<void> => actions.forwardMessages(getDeps(), input),

    markRead: async (input: {
      chatId: number
      topicId?: number
      upToMessageId: number
    }): Promise<void> => actions.markRead(getDeps(), input),

    sendTyping: async (
      chatId: number,
      typing: boolean,
      action?: 'typing' | 'recording',
      topicId?: number,
    ): Promise<void> => actions.sendTyping(getDeps(), chatId, typing, action, topicId),

    resendMessages: async (chatId: number, messageIds: number[]): Promise<void> =>
      actions.resendMessages(getDeps(), chatId, messageIds),

    /** 取消上传: removes a pending message; TDLib cancels its upload with it. */
    cancelSend: async (input: {
      chatId: number
      messageId: number
    }): Promise<void> => actions.cancelSend(getDeps(), input),

    sendMedia: async (input: {
      chatId: number
      topicId?: number
      filePath: string
      kind: MediaKind
      caption?: string
      replyTo?: number
    }): Promise<{ localId: string; message: Message }> => actions.sendMedia(getDeps(), input),

    /** 相册: photos and videos in one album; see `actions/send.ts sendAlbum`. */
    sendAlbum: async (input: {
      chatId: number
      topicId?: number
      items: Array<{ filePath: string; kind: 'photo' | 'video'; caption?: string }>
      replyTo?: number
    }): Promise<{ localIds: string[]; messages: Message[] }> => actions.sendAlbum(getDeps(), input),

    sendSticker: async (input: {
      chatId: number
      topicId?: number
      fileId: number
      replyTo?: number
    }): Promise<{ localId: string; message: Message }> => actions.sendSticker(getDeps(), input),

    /** 语音消息: one recorded OGG/Opus clip; see `actions/send.ts sendVoice`. */
    sendVoiceNote: async (input: {
      chatId: number
      topicId?: number
      filePath: string
      duration: number
      replyTo?: number
    }): Promise<{ localId: string; message: Message }> => actions.sendVoice(getDeps(), input),
  }
}
