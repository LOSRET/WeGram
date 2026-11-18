import { z } from 'zod'

import {
  appInfoSchema,
  appSettingsSchema,
  authStateSchema,
  chatOpSchema,
  chatSummarySchema,
  connectionStateSchema,
  messageEntitySchema,
  messageOpSchema,
  messageSchema,
  proxyConfigSchema,
  proxyTestResultSchema,
  scrollAnchorSchema,
  selfSchema,
  stickerSetSchema,
  userAvatarSchema,
  stickerSetSummarySchema,
  viewerItemSchema,
  viewerStateSchema,
} from './dto'
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
  'messages:history',
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
  'messages:history': {
    request: z.object({
      chatId: z.number().int(),
      fromMessageId: z.number().int().optional(),
      limit: z.number().int().positive().max(100),
    }),
    response: z.object({ messages: z.array(messageSchema), hasMore: z.boolean() }),
  },
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
  'ui:saveDraft': {
    request: z.object({
      chatId: z.number().int(),
      text: z.string(),
      entities: z.array(messageEntitySchema).optional(),
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
      items: z.array(viewerItemSchema).min(1).max(200),
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
