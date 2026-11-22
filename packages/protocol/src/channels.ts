import { z } from 'zod'

import { authStateSchema, messageSchema, scrollAnchorSchema, selfSchema } from './dto'
import { messagePropertiesSchema } from './properties'
import { bootStateSchema } from './boot'
import { chatSummarySchema } from './chat'
import type { EventChannel, EventEnvelope } from './events'
import { sendInvokeChannels, sendInvokeSchemas } from './send'
import { voiceInvokeChannels, voiceInvokeSchemas } from './voice'
import { presenceInvokeChannels, presenceInvokeSchemas } from './presence'
import { userInvokeChannels, userInvokeSchemas } from './user'
import { reportInvokeChannels, reportInvokeSchemas } from './report'
import { chatInvokeChannels, chatInvokeSchemas } from './chats'
import { qrInvokeChannels, qrInvokeSchemas } from './qr'
import { pollInvokeChannels, pollInvokeSchemas } from './poll'
import { networkInvokeChannels, networkInvokeSchemas } from './network'
import { customEmojiStickerSchema, stickerSetSchema, stickerSetSummarySchema } from './stickers'
import {
  appInfoSchema,
  appSettingsSchema,
  proxyConfigSchema,
  proxyTestResultSchema,
  RECENT_EMOJI_LIMIT,
} from './settings'
import { viewerItemsSchema, viewerStateSchema } from './viewer'
import {
  commentAccessSchema,
  commentJoinResultSchema,
  commentPageSchema,
  commentQuerySchema,
  commentSendSchema,
  commentSentSchema,
  commentTargetSchema,
} from './comment'
import { contactSchema } from './contact'
import { searchMessagesRequestSchema, searchMessagesResponseSchema } from './search'

/**
 * Single source of truth for the IPC contract (design doc §7).
 *
 * The renderer may only name channels that appear in these tables; the preload
 * script refuses anything else and the main process re-validates every payload
 * with the zod schemas below.
 */

export const invokeChannels = [
  'auth:state',
  'auth:start',
  'auth:code',
  'auth:password',
  /** Registers a number Telegram does not know yet (`waitRegistration`). */
  'auth:signup',
  /** Requests QR-code login; the answer arrives as `evt:auth` with `waitQr`. */
  'auth:qr',
  /**
   * Cancels QR confirmation by restarting the TDLib client (TDLib has no cancel
   * call), so the login window can fall back to the phone form.
   */
  'auth:reset',
  'auth:logout',
  'auth:me',
  /** Startup phase: what TDLib is doing before authorization can begin. */
  'boot:state',
  /** The chat domain's keys live in ./chats.ts; this stays the one channel list. */
  ...chatInvokeChannels,
  /** 群二维码 is its own window; see ./qr.ts. */
  ...qrInvokeChannels,
  /** Vote and add an option on a poll (see ./poll.ts). */
  ...pollInvokeChannels,
  /**
   * The account's Telegram address book (通讯录). People, not conversations:
   * the list comes from TDLib's `getContacts`, so a contact without a private
   * chat still appears, and 发消息 creates the chat on demand.
   */
  'contacts:list',
  'messages:history',
  /**
   * One window centred on a message, for a reading position or unread boundary
   * older than the newest page. Unlike paging back from the newest message this
   * does not need to walk the gap, so a deep position stays reachable.
   */
  'messages:around',
  /** One page below a window that does not reach the newest message. */
  'messages:newer',
  /**
   * One page of a message's comment thread (a channel's discussion group, or the
   * replies to a post inside that group). `fromMessageId` pages towards older
   * comments; the answer is ascending, like every transcript page.
   */
  'messages:comments',
  /**
   * Whether this account may post in the thread's discussion group, and whether
   * a join button is the next step (design doc §9.8). Mirrors the official
   * client: no server "can comment" call, the adapter composes it from the
   * supergroup's membership status, join-to-send flag and permissions.
   */
  'messages:commentInfo',
  /** Joins the thread's discussion group (or sends a join request). */
  'messages:joinCommentGroup',
  /**
   * Posts a comment on a message (the discussion view's input). TDLib keeps the
   * thread in the linked supergroup, so the adapter resolves the chat itself.
   */
  'messages:sendComment',
  'messages:send',
  'messages:edit',
  /** 编辑说明: a media message's caption (`editMessageCaption`), not its text. */
  'messages:editCaption',
  'messages:delete',
  /** Per-message capabilities for the context menu (`getMessageProperties`). */
  'messages:properties',
  /**
   * 转文字: asks TDLib to recognise a voice note's speech (`recognizeSpeech`). The
   * transcript itself arrives as a content update, so the answer carries nothing.
   */
  'messages:transcribe',
  'messages:forward',
  'messages:read',
  'messages:sendSticker',
  /** Outgoing typing and failed-message retry; see ./send.ts. */
  ...sendInvokeChannels,
  /** 语音消息: a recorded OGG/Opus clip; see ./voice.ts. */
  ...voiceInvokeChannels,
  ...presenceInvokeChannels,
  /** 资料卡: the person card and its 备注 / 联系人 writes; see ./user.ts. */
  ...userInvokeChannels,
  /** 举报: the phased reportChat contract, for a person or one message; ./report.ts. */
  ...reportInvokeChannels,
  'search:global',
  'search:inChat',
  /**
   * Searches message text across chats (the search panel's 聊天 / 频道 tabs),
   * with TDLib's chat-type filter doing the partitioning: 聊天 covers private
   * chats and groups, 频道 covers channels.
   */
  'search:messages',
  'media:pick',
  /** 相册发送: several photos as one folded bubble. */
  'media:sendAlbum',
  'media:download',
  /**
   * Drops one holder of a file's download. Main stops the transfer only when
   * nobody is waiting for it any more — a bubble that scrolled away, a closed
   * viewer — so two windows showing one photo never cancel each other.
   */
  'media:cancel',
  /**
   * A `wx-media://` URL for a video the viewer starts playing before TDLib has
   * finished downloading it; the scheme handler streams the bytes as they land.
   */
  'media:stream',
  'media:open',
  'media:send',
  'stickers:sets',
  'stickers:set',
  /** Custom emoji art by entity id (Telegram Premium's inline stickers). */
  'stickers:customEmoji',
  'ui:saveDraft',
  'ui:getDraft',
  'ui:saveAnchor',
  'ui:getAnchor',
  /**
   * Where the reader stopped inside one message's comment thread (§9.8). Keyed by
   * the commented message, so a channel's own reading position is never touched.
   */
  'ui:saveCommentAnchor',
  'ui:getCommentAnchor',
  /** Emoji the reader picked recently, newest first (the picker's 最近使用 row). */
  'ui:getRecentEmoji',
  'ui:saveRecentEmoji',
  'settings:get',
  'settings:set',
  'proxy:get',
  'proxy:set',
  'proxy:test',
  ...networkInvokeChannels,
  'app:info',
  /** The login window's 进入 button: main swaps it for the shell window. */
  'login:enter',
  /** The login window's own × (it is frameless, so Windows draws no controls). */
  'login:close',
  'viewer:open',
  'viewer:init',
  'viewer:save',
  'viewer:copy',
  'viewer:reveal',
  'viewer:pin',
  /**
   * 定位到聊天位置: the viewer hands the message it shows back to the shell, which
   * brings itself forward and lands on that row. The viewer stays open.
   */
  'viewer:locate',
  'viewer:close',
] as const

export type InvokeChannel = (typeof invokeChannels)[number]

type ChannelSchema = { request: z.ZodType; response: z.ZodType }

const noPayload = z.void()

export const invokeSchemas = {
  'auth:state': { request: noPayload, response: authStateSchema },
  'auth:start': { request: z.object({ phone: z.string().min(5) }), response: authStateSchema },
  'auth:code': { request: z.object({ code: z.string().min(1) }), response: authStateSchema },
  'auth:password': {
    request: z.object({ password: z.string().min(1) }),
    response: authStateSchema,
  },
  'auth:signup': {
    request: z.object({ firstName: z.string().min(1), lastName: z.string().optional() }),
    response: authStateSchema,
  },
  'auth:qr': { request: noPayload, response: authStateSchema },
  'auth:reset': { request: noPayload, response: authStateSchema },
  'auth:logout': { request: noPayload, response: noPayload },
  'auth:me': { request: noPayload, response: selfSchema },
  'boot:state': { request: noPayload, response: bootStateSchema },
  ...chatInvokeSchemas,
  ...qrInvokeSchemas,
  ...pollInvokeSchemas,
  'contacts:list': { request: noPayload, response: z.array(contactSchema) },
  'messages:history': {
    request: z.object({
      chatId: z.number().int(),
      fromMessageId: z.number().int().optional(),
      limit: z.number().int().positive().max(100),
    }),
    response: z.object({ messages: z.array(messageSchema), hasMore: z.boolean() }),
  },
  'messages:around': {
    request: z.object({
      chatId: z.number().int(),
      messageId: z.number().int(),
      /** Messages kept on each side of `messageId`; the window is at most twice this. */
      limit: z.number().int().positive().max(50),
    }),
    /**
     * `hasMore` means older messages may exist, `hasNewer` that the window does
     * not reach the newest message. A window that reaches the newest one is a
     * normal transcript window again.
     */
    response: z.object({
      messages: z.array(messageSchema),
      hasMore: z.boolean(),
      hasNewer: z.boolean(),
    }),
  },
  'messages:newer': {
    request: z.object({
      chatId: z.number().int(),
      fromMessageId: z.number().int(),
      limit: z.number().int().positive().max(100),
    }),
    response: z.object({ messages: z.array(messageSchema), hasNewer: z.boolean() }),
  },
  'messages:comments': { request: commentQuerySchema, response: commentPageSchema },
  'messages:commentInfo': { request: commentTargetSchema, response: commentAccessSchema },
  'messages:joinCommentGroup': {
    request: commentTargetSchema,
    response: commentJoinResultSchema,
  },
  'messages:sendComment': { request: commentSendSchema, response: commentSentSchema },
  'messages:send': {
    request: z.object({
      chatId: z.number().int(),
      text: z.string().min(1),
      replyTo: z.number().int().optional(),
    }),
    response: z.object({ localId: z.string(), message: messageSchema }),
  },
  'messages:edit': {
    request: z.object({
      chatId: z.number().int(),
      messageId: z.number().int(),
      text: z.string(),
    }),
    response: messageSchema,
  },
  /** 编辑说明: an empty caption removes it, which is TDLib's null `caption`. */
  'messages:editCaption': {
    request: z.object({
      chatId: z.number().int(),
      messageId: z.number().int(),
      caption: z.string().max(4096),
    }),
    response: messageSchema,
  },
  'messages:delete': {
    request: z.object({
      chatId: z.number().int(),
      messageIds: z.array(z.number().int()).min(1),
      forBoth: z.boolean(),
    }),
    response: noPayload,
  },
  'messages:properties': {
    request: z.object({ chatId: z.number().int(), messageId: z.number().int() }),
    response: messagePropertiesSchema,
  },
  'messages:transcribe': {
    request: z.object({ chatId: z.number().int(), messageId: z.number().int() }),
    response: noPayload,
  },
  'messages:forward': {
    request: z.object({
      fromChatId: z.number().int(),
      messageIds: z.array(z.number().int()).min(1),
      toChatId: z.number().int(),
    }),
    response: noPayload,
  },
  'messages:read': {
    request: z.object({ chatId: z.number().int(), upToMessageId: z.number().int() }),
    response: noPayload,
  },
  'messages:sendSticker': {
    request: z.object({
      chatId: z.number().int(),
      fileId: z.number().int(),
      replyTo: z.number().int().optional(),
    }),
    response: z.object({ localId: z.string(), message: messageSchema }),
  },
  ...sendInvokeSchemas,
  ...voiceInvokeSchemas,
  ...presenceInvokeSchemas,
  ...userInvokeSchemas,
  ...reportInvokeSchemas,
  'search:global': {
    request: z.object({ q: z.string().min(1), limit: z.number().int().positive().max(50) }),
    response: z.array(chatSummarySchema),
  },
  'search:inChat': {
    request: z.object({
      chatId: z.number().int(),
      q: z.string().min(1),
      fromMessageId: z.number().int().optional(),
    }),
    response: z.array(messageSchema),
  },
  /** Cross-chat message search; schemas live in `search.ts`. */
  'search:messages': {
    request: searchMessagesRequestSchema,
    response: searchMessagesResponseSchema,
  },
  /** Opens the native file dialog; an empty list means the user cancelled. */
  'media:pick': {
    request: z.object({ kind: z.enum(['photo', 'file']) }),
    response: z.object({ paths: z.array(z.string()) }),
  },
  'media:download': {
    request: z.object({
      fileId: z.number().int(),
      priority: z.number().int().min(1).max(32),
      /**
       * Who is waiting for this file. Holders share one transfer (a bubble and
       * the viewer can show the same photo); `media:cancel` releases only this
       * holder, and TDLib is told to stop when the last one leaves.
       */
      owner: z.string().min(1).max(64),
    }),
    response: z.object({ path: z.string(), url: z.string() }),
  },
  'media:cancel': {
    request: z.object({ fileId: z.number().int(), owner: z.string().min(1).max(64) }),
    response: noPayload,
  },
  'media:stream': {
    request: z.object({ fileId: z.number().int(), owner: z.string().min(1).max(64) }),
    response: z.object({ url: z.string() }),
  },
  /** Hands a downloaded file to the OS (default app / media player). */
  'media:open': {
    request: z.object({ fileId: z.number().int() }),
    response: noPayload,
  },
  /**
   * 相册: several local files as ONE Telegram album (`sendMessageAlbum`), so they
   * arrive as a folded bubble instead of N messages. 2–10 items, photos only —
   * that is the set the transcript folds back into one row (design doc §8.6).
   */
  'media:sendAlbum': {
    request: z.object({
      chatId: z.number().int(),
      items: z
        .array(
          z.object({
            filePath: z.string().min(1),
            kind: z.enum(['photo', 'file']),
            caption: z.string().optional(),
          }),
        )
        .min(2)
        .max(10),
      replyTo: z.number().int().optional(),
    }),
    /** `localIds` line up with `messages`: the composer tracks one per row. */
    response: z.object({
      localIds: z.array(z.string()),
      messages: z.array(messageSchema),
    }),
  },
  'media:send': {
    request: z.object({
      chatId: z.number().int(),
      filePath: z.string().min(1),
      kind: z.enum(['photo', 'file']),
      caption: z.string().optional(),
      replyTo: z.number().int().optional(),
    }),
    response: z.object({ localId: z.string(), message: messageSchema }),
  },
  'stickers:sets': { request: noPayload, response: z.array(stickerSetSummarySchema) },
  'stickers:set': { request: z.object({ setId: z.string().min(1) }), response: stickerSetSchema },
  /**
   * Up to 200 ids per call (TDLib's own limit). Unknown ids are simply absent from
   * the answer, which the renderer draws as the base glyph.
   */
  'stickers:customEmoji': {
    request: z.object({ ids: z.array(z.string().regex(/^\d+$/)).min(1).max(200) }),
    response: z.array(customEmojiStickerSchema),
  },
  /**
   * The draft is plain text: the composer has no formatting controls, so the
   * `entities` field that used to sit here was never sent, stored or read back —
   * it only made the handler's hand-written cast look complete. Add it back
   * together with a caller.
   */
  'ui:saveDraft': {
    request: z.object({
      chatId: z.number().int(),
      text: z.string(),
      replyTo: z.number().int().optional(),
    }),
    response: noPayload,
  },
  'ui:getDraft': {
    request: z.object({ chatId: z.number().int() }),
    response: z.object({ text: z.string(), replyTo: z.number().int().optional() }).nullable(),
  },
  /**
   * `messageId: null` means "the reader was at the bottom" and clears the anchor,
   * so reopening the chat lands on the newest message.
   */
  'ui:saveAnchor': {
    request: z.object({
      chatId: z.number().int(),
      messageId: z.number().int().nullable(),
      offset: z.number().int(),
    }),
    response: noPayload,
  },
  'ui:getAnchor': {
    request: z.object({ chatId: z.number().int() }),
    response: scrollAnchorSchema.nullable(),
  },
  /**
   * The discussion view's reading position (§9.8), keyed by the commented message.
   * Unlike a chat's anchor there is no "bottom" sentinel: a thread with no stored
   * row opens at its top, and a stored row is restored when it is still loaded.
   */
  'ui:saveCommentAnchor': {
    request: z.object({
      chatId: z.number().int(),
      messageId: z.number().int(),
      anchorMessageId: z.number().int(),
      offset: z.number().int(),
    }),
    response: noPayload,
  },
  'ui:getCommentAnchor': {
    request: z.object({ chatId: z.number().int(), messageId: z.number().int() }),
    response: scrollAnchorSchema.nullable(),
  },
  'ui:getRecentEmoji': { request: noPayload, response: z.array(z.string()) },
  'ui:saveRecentEmoji': {
    request: z.object({ emoji: z.array(z.string().min(1).max(32)).max(RECENT_EMOJI_LIMIT) }),
    response: noPayload,
  },
  'settings:get': { request: noPayload, response: appSettingsSchema },
  'settings:set': {
    request: z.object({ patch: appSettingsSchema.partial() }),
    response: noPayload,
  },
  'proxy:get': { request: noPayload, response: proxyConfigSchema.nullable() },
  'proxy:set': { request: z.object({ config: proxyConfigSchema.nullable() }), response: noPayload },
  'proxy:test': {
    request: z.object({ config: proxyConfigSchema }),
    response: proxyTestResultSchema,
  },
  ...networkInvokeSchemas,
  'app:info': { request: noPayload, response: appInfoSchema },
  'login:enter': { request: noPayload, response: noPayload },
  'login:close': { request: noPayload, response: noPayload },
  /**
   * Opens (or re-targets) the standalone 图片和视频 window. The renderer sends the
   * strip it wants to page through, because it owns the transcript.
   */
  'viewer:open': {
    request: z.object({
      /** The conversation the strip was taken from; 定位到聊天位置 needs it. */
      chatId: z.number().int(),
      items: viewerItemsSchema,
      index: z.number().int().nonnegative(),
    }),
    response: noPayload,
  },
  /** Called by the viewer window itself to learn what it has to show. */
  'viewer:init': { request: noPayload, response: viewerStateSchema },
  /** 保存: a real Save-As dialog for the media file, extension preserved. */
  'viewer:save': {
    request: z.object({ fileId: z.number().int() }),
    response: z.object({ canceled: z.boolean(), path: z.string().optional() }),
  },
  /** 复制: puts the decoded bitmap on the clipboard, not the file path. Photos only. */
  'viewer:copy': { request: z.object({ fileId: z.number().int() }), response: noPayload },
  'viewer:reveal': { request: z.object({ fileId: z.number().int() }), response: noPayload },
  /** 置顶: always-on-top for this window only; answers the state it settled on. */
  'viewer:pin': {
    request: z.object({ onTop: z.boolean() }),
    response: z.object({ onTop: z.boolean() }),
  },
  /**
   * 定位到聊天位置: the shell opens the conversation of the item the viewer is on
   * and scrolls to it. The message id comes from the viewer (it may have paged
   * since opening); the chat comes from the strip `viewer:open` registered.
   */
  'viewer:locate': {
    request: z.object({ messageId: z.number().int() }),
    response: noPayload,
  },
  'viewer:close': { request: noPayload, response: noPayload },
} satisfies Record<InvokeChannel, ChannelSchema>

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof invokeSchemas)[C]['request']>
export type InvokeResponse<C extends InvokeChannel> = z.output<
  (typeof invokeSchemas)[C]['response']
>

/** The event tables live in ./events.ts (that file hit its own budget line). */

/** The only API the preload script exposes on `window.tg`. */
export interface TgBridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    payload?: InvokeRequest<C>,
  ): Promise<InvokeResponse<C>>
  on<C extends EventChannel>(channel: C, callback: (event: EventEnvelope<C>) => void): () => void
}
