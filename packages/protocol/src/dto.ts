import { z } from 'zod'

/**
 * Domain DTOs shared by main and renderer.
 *
 * Rule of this package: everything that crosses IPC is declared here, and the
 * renderer never sees raw TDLib JSON. When TDLib changes a field, only the
 * adapter in `apps/desktop/src/main/telegram/tdlib/**` needs to be touched.
 */

export const selfSchema = z.object({
  id: z.number().int(),
  firstName: z.string(),
  lastName: z.string().optional(),
  username: z.string().optional(),
  phone: z.string().optional(),
  /** `wx-media://` URL of the profile photo; absent while it is not downloaded. */
  avatarUrl: z.string().optional(),
})
export type Self = z.infer<typeof selfSchema>

/**
 * Authorization state machine.
 *
 * TDLib's `AuthorizationState` and `ConnectionState` are two different things:
 * the UI has to display them separately (design doc §6.1).
 */
export const authStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle') }),
  z.object({ kind: z.literal('waitPhoneNumber') }),
  z.object({
    kind: z.literal('waitCode'),
    hint: z.string().optional(),
    codeLength: z.number().int().optional(),
  }),
  z.object({ kind: z.literal('waitPassword'), hint: z.string().optional() }),
  z.object({ kind: z.literal('ready'), me: selfSchema }),
  z.object({ kind: z.literal('closed') }),
])
export type AuthState = z.infer<typeof authStateSchema>

export const connectionStateSchema = z.enum(['online', 'connecting', 'offline', 'updating'])
export type ConnectionState = z.infer<typeof connectionStateSchema>

export const chatKindSchema = z.enum(['private', 'group', 'channel'])
export type ChatKind = z.infer<typeof chatKindSchema>

export const chatSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  kind: chatKindSchema,
  unread: z.number().int().nonnegative(),
  pinned: z.boolean(),
  muted: z.boolean(),
  lastMessageText: z.string().optional(),
  lastMessageAt: z.number().optional(),
  /** Highest incoming message id the server considers read (unread divider). */
  lastReadInboxMessageId: z.number().int().optional(),
  /** Highest outgoing message id the peer has read (read receipt). */
  lastReadOutboxMessageId: z.number().int().optional(),
  /** `wx-media://` URL of the chat photo; filled in after it is downloaded. */
  avatarUrl: z.string().optional(),
})
export type ChatSummary = z.infer<typeof chatSummarySchema>

export const chatOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('upsert'), chat: chatSummarySchema }),
  z.object({ op: z.literal('remove'), chatId: z.number().int() }),
])
export type ChatOp = z.infer<typeof chatOpSchema>

/**
 * Telegram formatting is TL entities (offset + length + type), not Markdown.
 * Offsets are UTF-16 code units — see design doc §8.3.
 */
export const messageEntitySchema = z.object({
  type: z.enum([
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'code',
    'pre',
    'url',
    'textUrl',
    'mention',
    'hashtag',
    'spoiler',
    'customEmoji',
  ]),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  url: z.string().optional(),
  language: z.string().optional(),
  customEmojiId: z.number().int().optional(),
})
export type MessageEntity = z.infer<typeof messageEntitySchema>

/**
 * A media attachment. Download progress travels separately on `evt:file`, so the
 * message DTO stays immutable: only URLs that are already on disk are embedded.
 *
 * `localUrl` is a `wx-media://` URL served by the main process (or a `data:` URL
 * from the mock adapter). The renderer never receives a filesystem path and never
 * loads `file://`, which also keeps the browser preview working.
 */
export const messageMediaSchema = z.object({
  fileId: z.number().int(),
  thumbFileId: z.number().int().optional(),
  mimeType: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  duration: z.number().int().optional(),
  stickerFormat: z.enum(['webp', 'tgs', 'webm']).optional(),
  /** Emoji the sticker matches, used as its alt text and in the picker. */
  stickerEmoji: z.string().optional(),
  fileName: z.string().optional(),
  size: z.number().int().optional(),
  localUrl: z.string().optional(),
  thumbUrl: z.string().optional(),
  /** base64 JPEG, ~40px: instant blur-up placeholder (§8.2 rule 4). */
  minithumbnail: z.string().optional(),
})
export type MessageMedia = z.infer<typeof messageMediaSchema>

export const stickerFormatSchema = z.enum(['webp', 'tgs', 'webm'])
export type StickerFormat = z.infer<typeof stickerFormatSchema>

/** One sticker from a set (design doc §9.4: WebP / TGS / WebM). */
export const stickerSchema = z.object({
  fileId: z.number().int(),
  format: stickerFormatSchema,
  emoji: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  /** Static WebP/JPEG preview, used for grids so animations stay cheap. */
  thumbFileId: z.number().int().optional(),
})
export type Sticker = z.infer<typeof stickerSchema>

export const stickerSetSummarySchema = z.object({
  /** TDLib ids are int64, so they cross IPC as strings. */
  id: z.string(),
  title: z.string(),
  thumbnail: stickerSchema.optional(),
})
export type StickerSetSummary = z.infer<typeof stickerSetSummarySchema>

export const stickerSetSchema = stickerSetSummarySchema.extend({
  stickers: z.array(stickerSchema),
})
export type StickerSet = z.infer<typeof stickerSetSchema>

export const messageKindSchema = z.enum([
  'text',
  'photo',
  'video',
  'file',
  'sticker',
  'voice',
  'poll',
  'service',
])
export type MessageKind = z.infer<typeof messageKindSchema>

export const messageSchema = z.object({
  id: z.number().int(),
  chatId: z.number().int(),
  senderId: z.number().int(),
  /**
   * Set instead of `senderId` when the message was sent by a chat rather than a
   * user: channel posts, and anonymous admins inside groups/supergroups
   * (`messageSenderChat` in TDLib). `senderName` then carries the chat title.
   */
  senderChatId: z.number().int().optional(),
  senderName: z.string(),
  outgoing: z.boolean(),
  date: z.number().int(),
  kind: messageKindSchema,
  text: z.string(),
  entities: z.array(messageEntitySchema).optional(),
  media: messageMediaSchema.optional(),
  replyToId: z.number().int().optional(),
  edited: z.boolean().optional(),
})
export type Message = z.infer<typeof messageSchema>

export const messageOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('new'), message: messageSchema }),
  z.object({
    op: z.literal('edit'),
    chatId: z.number().int(),
    messageId: z.number().int(),
    text: z.string(),
  }),
  /** Full replacement, used when the server changes the content (media, caption). */
  z.object({ op: z.literal('replace'), message: messageSchema }),
  z.object({
    op: z.literal('delete'),
    chatId: z.number().int(),
    messageIds: z.array(z.number().int()),
  }),
  z.object({ op: z.literal('read'), chatId: z.number().int(), upToMessageId: z.number().int() }),
])
export type MessageOp = z.infer<typeof messageOpSchema>

/**
 * Where the reader stopped in a chat (design doc §8.2 rule 5).
 *
 * `offset` is the anchor row's top relative to the viewport top in pixels and can
 * be negative when that row starts above the viewport. No stored anchor at all
 * means "the reader was at the bottom", which is the normal case and needs no
 * resume: the list lands at the newest message.
 */
export const scrollAnchorSchema = z.object({
  messageId: z.number().int(),
  offset: z.number().int(),
})
export type ScrollAnchor = z.infer<typeof scrollAnchorSchema>

/**
 * Proxy configuration.
 *
 * Secrets crossing IPC are always `MASK` when already stored; sending `MASK`
 * back on `proxy:set` means "keep the stored secret" (design doc §6.4).
 */
export const MASK = '***' as const

export const proxyConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('socks5'),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    username: z.string().optional(),
    password: z.string().optional(),
  }),
  z.object({
    type: z.literal('mtproto'),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secret: z.string().optional(),
  }),
])
export type ProxyConfig = z.infer<typeof proxyConfigSchema>

export const proxyTestResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
})
export type ProxyTestResult = z.infer<typeof proxyTestResultSchema>

export const appSettingsSchema = z.object({
  theme: z.enum(['light', 'dark']),
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const appInfoSchema = z.object({
  version: z.string(),
  appVersion: z.string(),
  adapter: z.enum(['mock', 'tdlib']),
  tdlibVersion: z.string().optional(),
  userDataPath: z.string(),
})
export type AppInfo = z.infer<typeof appInfoSchema>

export type { z }
