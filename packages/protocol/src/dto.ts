import { z } from 'zod'

import { pollSchema } from './poll'
import { stickerFormatSchema } from './stickers'

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
  /**
   * A number Telegram does not know yet. TDLib asks for a first name before the
   * account exists (`authorizationStateWaitRegistration`); every fresh test-DC
   * number starts here, which is why the test environment needs this step.
   */
  z.object({ kind: z.literal('waitRegistration') }),
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
    /**
     * A mention of a user by id (`textEntityTypeMentionName`): right-to-left
     * scripts and users without a username are mentioned by their name, and only
     * this entity carries the id the renderer can open.
     */
    'mentionName',
    'hashtag',
    'spoiler',
    'customEmoji',
  ]),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  url: z.string().optional(),
  language: z.string().optional(),
  /**
   * `mentionName` only: the mentioned user's id. A `mention` carries none — its
   * text is the `@username`, resolved when the reader taps it.
   */
  userId: z.number().int().optional(),
  /**
   * The custom emoji's id (TDLib int64), as a **string**: real ids exceed
   * `Number.MAX_SAFE_INTEGER` (measured 2026-11-20: 5909018290759408000), so a
   * number would silently round the id and never match the sticker.
   */
  customEmojiId: z.string().optional(),
})
export type MessageEntity = z.infer<typeof messageEntitySchema>

/**
 * One downloadable variant of a photo (TDLib `photoSize`), smallest first in the
 * parent's list.
 *
 * The official client never downloads the largest picture for a chat bubble: it
 * asks for the smallest variant that still covers the box it is about to draw,
 * and the largest one only when the reader opens the picture. Carrying the list
 * is what lets `lib/mediaVariant.ts` make the same choice.
 */
export const mediaSizeSchema = z.object({
  fileId: z.number().int().positive(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
export type MediaSize = z.infer<typeof mediaSizeSchema>

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
  /**
   * Every size TDLib offers for a photo, smallest first (`fileId` above is the
   * largest one, so the viewer, 保存 and 复制 keep asking for the full picture).
   * Absent for videos, files and voices, and for a photo TDLib sent without its
   * size table.
   */
  sizes: z.array(mediaSizeSchema).optional(),
  duration: z.number().int().optional(),
  /**
   * A GIF-style animation (TDLib `messageAnimation`): an MP4 the bubble plays
   * inline, muted and looping, the way Telegram does. `kind` stays 'video'
   * because the file and its viewer are the same; this flag is what tells the
   * bubble not to wait for a click before it plays.
   */
  isAnimation: z.boolean().optional(),
  stickerFormat: stickerFormatSchema.optional(),
  /**
   * The thumbnail's own format. TDLib serves a static image as a sticker's
   * thumbnail even for TGS/WebM stickers, so a grid that renders the thumbnail
   * must not reuse `stickerFormat`.
   */
  stickerThumbFormat: stickerFormatSchema.optional(),
  /** Emoji the sticker matches, used as its alt text and in the picker. */
  stickerEmoji: z.string().optional(),
  /**
   * Click sound of an animated emoji (TDLib `animatedEmoji.sound`, OGG/Opus). It is
   * fetched on the first click, so an emoji the reader never taps costs no download.
   */
  soundFileId: z.number().int().optional(),
  /**
   * A Telegram Premium sticker's effect (TDLib `stickerFullTypeRegular.premium_animation`,
   * a TGS file). It is a second file, drawn once over the sticker when the message
   * appears — the official client's behaviour. Present only when TDLib also set
   * `messageSticker.is_premium`, i.e. when the effect is meant to play.
   */
  premiumEffectFileId: z.number().int().optional(),
  /** `wx-media://` URL of an effect TDLib already downloaded (see above). */
  premiumEffectUrl: z.string().optional(),
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
  /**
   * Telegram's animated emoji: a message that is exactly one emoji (`messageAnimatedEmoji`).
   * `media` is the animated sticker drawn instead of the glyph, `text` keeps the glyph
   * for previews, quotes and 复制; a custom emoji whose sticker is not known yet falls
   * back to kind 'text'.
   */
  'emoji',
  'voice',
  'poll',
  'service',
  /** A system/inline page of blocks; see 'rich'. */
  'rich',
  /** A vCard card (`contact`), drawn as a contact bubble. */
  'contact',
])
export type MessageKind = z.infer<typeof messageKindSchema>

/**
 * Engagement under a message — the row WeChat's article cards carry above their
 * comment list. TDLib fills it from `messageInteractionInfo`: counters on
 * channels, and `reply_info` wherever the message owns a comment thread (a
 * channel post with a discussion group, and the posts inside that group).
 *
 * The renderer draws a comment bar from this alone, so no extra request is
 * needed until the reader actually opens the thread.
 */
export const messageInteractionSchema = z.object({
  /** 阅读: TDLib `view_count`. Absent when the chat has no view counter. */
  views: z.number().int().nonnegative().optional(),
  /** 转发: TDLib `forward_count`. */
  forwards: z.number().int().nonnegative().optional(),
  /** 评论: replies to the message (`reply_info.reply_count`), nested ones included. */
  comments: z.number().int().nonnegative(),
  /**
   * Whether the message owns a comment thread. TDLib 1.8.70's `message` carries
   * no `properties` field (only `getMessageProperties` answers that), so this is
   * read from `reply_info` being present — the thread exists even before anyone
   * has commented (`comments === 0`), which is what makes 写评论 reachable.
   */
  canOpen: z.boolean().optional(),
})
export type MessageInteraction = z.infer<typeof messageInteractionSchema>

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
  /**
   * TDLib `message.can_be_saved`: false for protected content (the chat's
   * `has_protected_content`), which the viewer's 保存/复制 must respect. Optional
   * so fixtures without the flag stay valid; only an explicit false blocks.
   */
  canBeSaved: z.boolean().optional(),
  date: z.number().int(),
  kind: messageKindSchema,
  text: z.string(),
  entities: z.array(messageEntitySchema).optional(),
  media: messageMediaSchema.optional(),
  /** Body of a kind 'rich' message; text still carries its flattened words. */
  rich: z.array(richBlockSchema).optional(),
  /** Body of a kind 'contact' message. */
  contact: contactCardSchema.optional(),
  /** Body of a kind 'poll' message (design doc §9.10). */
  poll: pollSchema.optional(),
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
  /** Views / forwards / comments under the message; absent when there are none. */
  interaction: messageInteractionSchema.optional(),
})
export type Message = z.infer<typeof messageSchema>

/**
 * The per-message capabilities TDLib answers through `getMessageProperties`
 * (offline). The context menu asks when it opens instead of deriving 编辑/转发/删除
 * from `outgoing` and `kind`: TDLib owns the 48-hour edit window, protected
 * content, per-chat rights and the "delete for me vs for everyone" split.
 */
export const messagePropertiesSchema = z.object({
  canBeEdited: z.boolean(),
  canBeForwarded: z.boolean(),
  canBeDeletedOnlyForSelf: z.boolean(),
  canBeDeletedForAllUsers: z.boolean(),
  canBeCopied: z.boolean(),
  canBeReplied: z.boolean(),
})
export type MessageProperties = z.infer<typeof messagePropertiesSchema>

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
  /**
   * Engagement moved (views, forwards, replies) without the message changing:
   * patching the counter is far cheaper than remapping the whole message, and
   * `updateMessageInteractionInfo` fires on every view.
   *
   * The patch is partial on purpose: TDLib omits `reply_info` from an update
   * whenever it has no reply data at hand, and a missing field must not erase
   * what the history page already delivered (a view-only update used to zero a
   * real comment count and take the comment bar with it).
   */
  z.object({
    op: z.literal('interaction'),
    chatId: z.number().int(),
    messageId: z.number().int(),
    interaction: messageInteractionSchema.partial(),
  }),
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

/* Settings / proxy / app-info DTOs live in `settings.ts`; the viewer's in
   `viewer.ts` — both were split out when this file reached its line budget. */

export type { z }
