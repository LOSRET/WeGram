import { z } from 'zod'

import {
  authStateSchema,
  chatOpSchema,
  chatSummarySchema,
  connectionStateSchema,
  messageOpSchema,
  messageSchema,
  scrollAnchorSchema,
  selfSchema,
  stickerSetSchema,
  userAvatarSchema,
  stickerSetSummarySchema,
} from './dto'
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
import { appErrorSchema } from './errors'

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
  'chats:list',
  'chats:get',
  'chats:open',
  /** Opens (creating if needed) the private chat of a contact card's user. */
  'chats:openPrivate',
  /**
   * Whether this account may post in the chat. Only channels ask: posting there
   * is an administrator right, so the composer is offered only when it holds.
   */
  'chats:canPost',
  /** 静音 / 取消静音 for the channel bar; answers the refreshed summary. */
  'chats:setMuted',
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
  'messages:delete',
  'messages:forward',
  'messages:read',
  'messages:sendSticker',
  'search:global',
  'search:inChat',
  'media:pick',
  'media:download',
  'media:open',
  'media:send',
  'stickers:sets',
  'stickers:set',
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
  'chats:list': {
    request: z.object({
      limit: z.number().int().positive().max(200),
      offset: z.number().int().nonnegative(),
    }),
    response: z.array(chatSummarySchema),
  },
  'chats:get': { request: z.object({ chatId: z.number().int() }), response: chatSummarySchema },
  'chats:open': { request: z.object({ chatId: z.number().int() }), response: noPayload },
  'chats:openPrivate': {
    request: z.object({ userId: z.number().int() }),
    response: chatSummarySchema,
  },
  'chats:canPost': { request: z.object({ chatId: z.number().int() }), response: z.boolean() },
  'chats:setMuted': {
    request: z.object({ chatId: z.number().int(), muted: z.boolean() }),
    response: chatSummarySchema,
  },
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
  'messages:delete': {
    request: z.object({
      chatId: z.number().int(),
      messageIds: z.array(z.number().int()).min(1),
      forBoth: z.boolean(),
    }),
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
  /** Opens the native file dialog; an empty list means the user cancelled. */
  'media:pick': {
    request: z.object({ kind: z.enum(['photo', 'file']) }),
    response: z.object({ paths: z.array(z.string()) }),
  },
  'media:download': {
    request: z.object({ fileId: z.number().int(), priority: z.number().int().min(1).max(32) }),
    response: z.object({ path: z.string(), url: z.string() }),
  },
  /** Hands a downloaded file to the OS (default app / media player). */
  'media:open': {
    request: z.object({ fileId: z.number().int() }),
    response: noPayload,
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

/** Every event main pushes to the renderer is sequenced, so gaps are detectable (§7.2). */
const envelope = <S extends z.ZodType>(payload: S) => z.object({ seq: z.number().int(), payload })

export const eventChannels = [
  'evt:auth',
  'evt:connection',
  'evt:chats',
  'evt:messages',
  /**
   * Profile photos of other people that finished downloading after their
   * messages were mapped (a group's senders, the peer of a private chat).
   */
  'evt:avatars',
  'evt:typing',
  'evt:file',
  /** TDLib reloaded the installed sticker sets; the picker refetches them. */
  'evt:stickerSets',
  /**
   * The viewer asked the shell to show a message (定位到聊天位置). Main raises the
   * shell window first, then publishes this; the viewer window stays open.
   */
  'evt:locate',
  'evt:error',
] as const

export type EventChannel = (typeof eventChannels)[number]

export const eventSchemas = {
  'evt:auth': envelope(authStateSchema),
  'evt:connection': envelope(connectionStateSchema),
  'evt:chats': envelope(z.object({ ops: z.array(chatOpSchema) })),
  'evt:messages': envelope(z.object({ chatId: z.number().int(), ops: z.array(messageOpSchema) })),
  'evt:avatars': envelope(z.object({ avatars: z.array(userAvatarSchema) })),
  'evt:typing': envelope(
    z.object({
      chatId: z.number().int(),
      userId: z.number().int(),
      action: z.string(),
      until: z.number(),
    }),
  ),
  'evt:file': envelope(
    z.object({
      fileId: z.number().int(),
      downloaded: z.number(),
      total: z.number(),
      /** Set once the file is fully local; a `wx-media://` URL for the renderer. */
      url: z.string().optional(),
      /** Bytes are going up rather than down (media being sent). */
      uploading: z.boolean().optional(),
      completed: z.boolean().optional(),
    }),
  ),
  'evt:stickerSets': envelope(z.object({})),
  'evt:locate': envelope(z.object({ chatId: z.number().int(), messageId: z.number().int() })),
  'evt:error': envelope(appErrorSchema),
} satisfies Record<EventChannel, z.ZodType>

export type EventEnvelope<C extends EventChannel> = z.output<(typeof eventSchemas)[C]>
export type EventPayload<C extends EventChannel> = EventEnvelope<C>['payload']

/** The only API the preload script exposes on `window.tg`. */
export interface TgBridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    payload?: InvokeRequest<C>,
  ): Promise<InvokeResponse<C>>
  on<C extends EventChannel>(channel: C, callback: (event: EventEnvelope<C>) => void): () => void
}
