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
  /** [start, end) spoiler runs of `lastMessageText`, so the row can mask them too. */
  lastMessageSpoilers: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
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
  /**
   * The thumbnail's own format. TDLib serves a static image as a sticker's
   * thumbnail even for TGS/WebM stickers, so a grid that renders the thumbnail
   * must not reuse `stickerFormat`.
   */
  stickerThumbFormat: z.enum(['webp', 'tgs', 'webm']).optional(),
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

/**
 * One button under a message or inside a rich page (Telegram's inline keyboard).
 * `url` is set for the kinds that open something; `callback` marks the ones that
 * send data to a bot — this client shows them but does not press them yet.
 */
/** Visual style a bot can put on a button (TDLib buttonStyle*). */
export const inlineButtonStyleSchema = z.enum(['default', 'primary', 'danger', 'success', 'link'])
export type InlineButtonStyle = z.infer<typeof inlineButtonStyleSchema>

export const inlineButtonSchema = z.object({
  text: z.string(),
  url: z.string().optional(),
  callback: z.boolean().optional(),
  /** Absent for the ordinary grey button; see inlineButtonStyleSchema. */
  style: inlineButtonStyleSchema.optional(),
})
export type InlineButton = z.infer<typeof inlineButtonSchema>

/** A vCard message body: the card a contact message draws. */
export const contactCardSchema = z.object({
  firstName: z.string(),
  lastName: z.string().optional(),
  phone: z.string(),
  /** TDLib user id of the contact; 0 means "not a Telegram user" and is dropped. */
  userId: z.number().int().optional(),
})
export type ContactCard = z.infer<typeof contactCardSchema>
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
  /** Format of `thumbFileId`; see `MessageMedia.stickerThumbFormat`. */
  thumbFormat: stickerFormatSchema.optional(),
})
export type Sticker = z.infer<typeof stickerSchema>

export const stickerSetSummarySchema = z.object({
  /** TDLib ids are int64, so they cross IPC as strings. */
  id: z.string(),
  title: z.string(),
  /**
   * The tab's picture: the set's own cover when TDLib has one, else its first
   * sticker (the installed list ships `covers`). Absent only when neither exists,
   * and then the picker shows two characters of the title instead.
   */
  thumbnail: stickerSchema.optional(),
})
export type StickerSetSummary = z.infer<typeof stickerSetSummarySchema>

export const stickerSetSchema = stickerSetSummarySchema.extend({
  stickers: z.array(stickerSchema),
})
export type StickerSet = z.infer<typeof stickerSetSchema>

/**
 * A run of text with the entities that style it (bold, links, mentions…). The
 * same shape as a message body, reused by every rich block that carries text.
 */
export const richFormattedSchema = z.object({
  text: z.string(),
  entities: z.array(messageEntitySchema).optional(),
})
export type RichFormatted = z.infer<typeof richFormattedSchema>

/** Typographic role of a text block; the renderer owns the sizes. */
export const richTextRoleSchema = z.enum([
  'title',
  'subtitle',
  'header',
  'subheader',
  'section',
  'kicker',
  'paragraph',
  'footer',
  'pre',
])
export type RichTextRole = z.infer<typeof richTextRoleSchema>

export const richAlignSchema = z.enum(['left', 'center', 'right'])
export type RichAlign = z.infer<typeof richAlignSchema>

/** Media kinds a rich block can hold; the same set MediaBubble renders. */
export const richMediaKindSchema = z.enum(['photo', 'video', 'file', 'voice'])
export type RichMediaKind = z.infer<typeof richMediaKindSchema>

export interface RichMedia {
  kind: RichMediaKind
  media: MessageMedia
  caption?: RichFormatted
  spoiler?: boolean
}

export interface RichListItem {
  /** Bullet, number or checkbox text; empty for a bare item. */
  label: string
  /** Ordinal of an ordered list (0 for unordered ones). */
  value: number
  checked?: boolean
  blocks: RichBlock[]
}

export interface RichTableCell {
  /** Absent when the cell is invisible (it still occupies its slot). */
  text?: RichFormatted
  header: boolean
  colspan: number
  rowspan: number
  align: RichAlign
}

/**
 * One block of a rich message (Telegram 'messageRichMessage'): the body is a
 * page — headings, paragraphs, lists, tables, quotes and media — not a caption.
 *
 * Declared by hand because the union is recursive: a list item, a quote and a
 * collapsible block each contain blocks again, and a lazy zod schema cannot
 * infer its own type. The schema below is annotated with this type, so drift
 * between the two is still a compile error.
 */
export type RichBlock =
  | { type: 'text'; role: RichTextRole; size?: number; text: RichFormatted }
  | { type: 'divider' }
  | { type: 'list'; items: RichListItem[] }
  | {
      type: 'table'
      bordered: boolean
      striped: boolean
      compact: boolean
      caption?: RichFormatted
      rows: RichTableCell[][]
    }
  | {
      type: 'media'
      kind: RichMediaKind
      media: MessageMedia
      caption?: RichFormatted
      spoiler?: boolean
    }
  | { type: 'gallery'; items: RichMedia[]; caption?: RichFormatted }
  | { type: 'quote'; blocks: RichBlock[]; credit?: RichFormatted; expandable?: boolean }
  | { type: 'details'; header: RichFormatted; blocks: RichBlock[]; open: boolean }
  | { type: 'buttons'; rows: InlineButton[][] }

const richListItemSchema: z.ZodType<RichListItem> = z.lazy(() =>
  z.object({
    label: z.string(),
    value: z.number().int(),
    checked: z.boolean().optional(),
    blocks: z.array(richBlockSchema),
  }),
)

const richTableCellSchema: z.ZodType<RichTableCell> = z.object({
  text: richFormattedSchema.optional(),
  header: z.boolean(),
  colspan: z.number().int(),
  rowspan: z.number().int(),
  align: richAlignSchema,
})

const richMediaSchema: z.ZodType<RichMedia> = z.object({
  kind: richMediaKindSchema,
  media: messageMediaSchema,
  caption: richFormattedSchema.optional(),
  spoiler: z.boolean().optional(),
})

export const richBlockSchema: z.ZodType<RichBlock> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      role: richTextRoleSchema,
      size: z.number().int().optional(),
      text: richFormattedSchema,
    }),
    z.object({ type: z.literal('divider') }),
    z.object({ type: z.literal('list'), items: z.array(richListItemSchema) }),
    z.object({
      type: z.literal('table'),
      bordered: z.boolean(),
      striped: z.boolean(),
      compact: z.boolean(),
      caption: richFormattedSchema.optional(),
      rows: z.array(z.array(richTableCellSchema)),
    }),
    z.object({
      type: z.literal('media'),
      kind: richMediaKindSchema,
      media: messageMediaSchema,
      caption: richFormattedSchema.optional(),
      spoiler: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('gallery'),
      items: z.array(richMediaSchema),
      caption: richFormattedSchema.optional(),
    }),
    z.object({
      type: z.literal('quote'),
      blocks: z.array(richBlockSchema),
      credit: richFormattedSchema.optional(),
      expandable: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('details'),
      header: richFormattedSchema,
      blocks: z.array(richBlockSchema),
      open: z.boolean(),
    }),
    z.object({ type: z.literal('buttons'), rows: z.array(z.array(inlineButtonSchema)) }),
  ]),
)
export const messageKindSchema = z.enum([
  'text',
  'photo',
  'video',
  'file',
  'sticker',
  'voice',
  'poll',
  'service',
  /** A system/inline page of blocks; see 'rich'. */
  'rich',
  /** A vCard card (`contact`), drawn as a contact bubble. */
  'contact',
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
  /** Body of a kind 'rich' message; text still carries its flattened words. */
  rich: z.array(richBlockSchema).optional(),
  /** Body of a kind 'contact' message. */
  contact: contactCardSchema.optional(),
  /** Inline keyboard under the bubble: rows of buttons (TDLib `reply_markup`). */
  buttons: z.array(z.array(inlineButtonSchema)).optional(),
  /**
   * Telegram media group (album). TDLib keys a group by `message.media_album_id`,
   * an int64 — it crosses IPC as a string, and `'0'` (not in an album) is absent.
   * Every item of an album is still its own message; the renderer folds
   * consecutive ones back into one bubble (design doc §8.6).
   */
  albumId: z.string().optional(),
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
