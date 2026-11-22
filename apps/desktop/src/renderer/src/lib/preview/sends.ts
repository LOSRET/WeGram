import type { ChatSummary, EventChannel, Message } from '@wegram/protocol'

import { stickerMedia } from '../stickerMedia'
import { ME, PREVIEW_STICKERS, media, msg, now } from './fixtures'
import { previewMessageProperties, previewTranscribe, type PreviewMessagesStore } from './messages'

/**
 * The preview's outgoing and row-mutating message handlers.
 *
 * Extracted from `index.ts` when 语音消息 pushed that switch past its line budget:
 * every one of these builds or rewrites a row of the preview's own transcript, and
 * the dispatcher below keeps the channel list in one place. The rules they reuse
 * (edit capabilities, 转文字) stay in `messages.ts`; the fixture casts are the
 * same `Record<string, any>` the switch always used, so nothing new is trusted.
 */

export interface PreviewSendContext {
  chats: ChatSummary[]
  messagesByChat: Record<number, Message[]>
  /** The rules view of the same session (see ./messages.ts). */
  messages: PreviewMessagesStore
  emit(channel: EventChannel, payload: unknown): void
  /** The session-wide row id counter. */
  takeId(): number
}

/** The channels this module answers; `index.ts` dispatches one `case` per name. */
const SEND_CHANNELS = new Set<string>([
  'messages:send',
  'messages:edit',
  'messages:editCaption',
  'messages:transcribe',
  'messages:properties',
  'messages:delete',
  'messages:forward',
  'messages:sendSticker',
  'messages:sendVoice',
])

export function isPreviewSendChannel(channel: string): boolean {
  return SEND_CHANNELS.has(channel)
}

export function handlePreviewSend(
  channel: string,
  store: Record<string, any>,
  ctx: PreviewSendContext,
): unknown {
  switch (channel) {
    case 'messages:send': {
      const chatId = Number(store.chatId)
      const list = ctx.messagesByChat[chatId] ?? []
      const message = msg(chatId, ctx.takeId(), String(store.text), true, 0)
      if (typeof store.replyTo === 'number') message.replyToId = store.replyTo
      list.push(message)
      ctx.messagesByChat[chatId] = list
      const chat = ctx.chats.find((item) => item.id === chatId)
      if (chat) {
        chat.lastMessageText = message.text
        chat.lastMessageAt = message.date
        ctx.emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
      }
      return { localId: `web-${message.id}`, message }
    }
    case 'messages:edit': {
      const list = ctx.messagesByChat[Number(store.chatId)] ?? []
      const target = list.find((item) => item.id === store.messageId)
      if (!target) throw { code: 'internal', message: 'message not found' }
      target.text = String(store.text)
      target.edited = true
      return target
    }
    case 'messages:editCaption': {
      const list = ctx.messagesByChat[Number(store.chatId)] ?? []
      const target = list.find((item) => item.id === store.messageId)
      if (!target) throw { code: 'internal', message: 'message not found' }
      target.text = String(store.caption ?? '')
      target.edited = true
      return { ...target }
    }
    /** 转文字: the fake transcript lives in ./messages.ts. */
    case 'messages:transcribe':
      return previewTranscribe(ctx.messages, Number(store.chatId), Number(store.messageId))
    /** The capability question; its rule lives in ./messages.ts. */
    case 'messages:properties':
      return previewMessageProperties(ctx.messages, Number(store.chatId), Number(store.messageId))
    case 'messages:delete': {
      const ids = store.messageIds as number[]
      ctx.messagesByChat[Number(store.chatId)] = (
        ctx.messagesByChat[Number(store.chatId)] ?? []
      ).filter((item) => !ids.includes(item.id))
      return undefined
    }
    case 'messages:forward': {
      const ids = store.messageIds as number[]
      const source = ctx.messagesByChat[Number(store.fromChatId)] ?? []
      const target = ctx.messagesByChat[Number(store.toChatId)] ?? []
      for (const id of ids) {
        const original = source.find((item) => item.id === id)
        if (original) target.push({ ...original, id: ctx.takeId(), chatId: Number(store.toChatId) })
      }
      ctx.messagesByChat[Number(store.toChatId)] = target
      return undefined
    }
    case 'messages:sendSticker': {
      const sticker = PREVIEW_STICKERS.find((item) => item.fileId === store.fileId)
      if (!sticker) throw { code: 'internal', message: 'unknown sticker' }
      const chatId = Number(store.chatId)
      const list = ctx.messagesByChat[chatId] ?? []
      const message: Message = {
        id: ctx.takeId(),
        chatId,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: now(),
        kind: 'sticker',
        text: '',
        media: media(sticker.fileId, stickerMedia(sticker)),
      }
      list.push(message)
      ctx.messagesByChat[chatId] = list
      return { localId: `web-${message.id}`, message }
    }
    /**
     * 语音消息 in the browser preview: the recorder hands over real OGG bytes, and
     * the bubble plays them from a blob URL — the preview has no wx-media:// host,
     * so this is the one place a `localUrl` is minted here. The object URL is
     * revoked only when the page goes away; a preview session is short-lived.
     */
    case 'messages:sendVoice': {
      const chatId = Number(store.chatId)
      const list = ctx.messagesByChat[chatId] ?? []
      const bytes = Uint8Array.from(atob(String(store.audio)), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }))
      const message: Message = {
        id: ctx.takeId(),
        chatId,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: now(),
        kind: 'voice',
        text: '',
        media: {
          fileId: ctx.takeId(),
          mimeType: 'audio/ogg',
          duration: Number(store.duration),
          size: bytes.byteLength,
          localUrl: url,
        },
      }
      if (typeof store.replyTo === 'number') message.replyToId = store.replyTo
      list.push(message)
      ctx.messagesByChat[chatId] = list
      const chat = ctx.chats.find((item) => item.id === chatId)
      if (chat) {
        chat.lastMessageText = '[语音]'
        chat.lastMessageAt = message.date
        ctx.emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
      }
      return { localId: `web-${message.id}`, message }
    }
    default:
      throw { code: 'not_implemented', message: `${channel} is not a preview send` }
  }
}
