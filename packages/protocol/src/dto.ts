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
  /**
   * QR login: TDLib's `authorizationStateWaitOtherDeviceConfirmation`. The link is
   * a `tg://login?token=…` URL that TDLib re-issues frequently; the login window
   * renders it as a QR code and the mobile app confirms the sign-in.
   */
  z.object({ kind: z.literal('waitQr'), link: z.string() }),
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
  /**
   * `wx-media://` URL of the sender's profile photo, when it was already
   * downloaded while the message was mapped. Photos that finish later arrive on
   * `evt:avatars` (keyed by user id), or with the chat's own `avatarUrl` when the
   * sender is a chat (channel post, anonymous admin).
   */
  senderAvatarUrl: z.string().optional(),
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

/**
 * A profile photo that finished downloading *after* the rows carrying it were
 * mapped. Users are identified by id rather than by message, because the same
 * person posts in many chats and the renderer draws one photo for all of them.
 */
export const userAvatarSchema = z.object({
  userId: z.number().int(),
  /** `wx-media://` URL served by the main process. */
  url: z.string(),
})
export type UserAvatar = z.infer<typeof userAvatarSchema>

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

/**
 * One item of the strip the standalone viewer window pages through.
 *
 * The client puts photos **and** videos in the same 图片和视频 window, so the item
 * carries its kind: the toolbar is shared, only the canvas and the bottom player
 * bar differ.
 *
 * The renderer owns the transcript, so it hands the viewer the whole strip plus
 * the index that was clicked; 上一张/下一张 then works without asking the adapter
 * for history again.
 */
export const viewerItemSchema = z.object({
  /** Media file id the viewer downloads through `media:download`. */
  fileId: z.number().int().positive(),
  /** Message carrying the media, so 更多 → 定位到聊天位置 keeps its origin. */
  messageId: z.number().int().optional(),
  kind: z.enum(['photo', 'video']),
  fileName: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  size: z.number().int().nonnegative().optional(),
  /** Seconds; lets the player show the total before the file has loaded. */
  duration: z.number().nonnegative().optional(),
  /** base64 JPEG, ~40px: paints the 预览 grid before a file has been fetched. */
  minithumbnail: z.string().optional(),
})
export type ViewerItem = z.infer<typeof viewerItemSchema>

/** What `viewer:init` answers: the strip, the current index and the theme. */
export const viewerStateSchema = z.object({
  items: z.array(viewerItemSchema).min(1).max(200),
  index: z.number().int().nonnegative(),
  theme: appSettingsSchema.shape.theme,
})
export type ViewerState = z.infer<typeof viewerStateSchema>

export const appInfoSchema = z.object({
  version: z.string(),
  appVersion: z.string(),
  adapter: z.enum(['mock', 'tdlib']),
  tdlibVersion: z.string().optional(),
  userDataPath: z.string(),
})
export type AppInfo = z.infer<typeof appInfoSchema>

export type { z }
