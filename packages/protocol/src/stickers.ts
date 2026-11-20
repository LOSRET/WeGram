import { z } from 'zod'

/**
 * The sticker domain of the IPC contract: the three formats the renderer draws,
 * one sticker from a set, a set itself, and a custom emoji's artwork.
 *
 * Split out of `dto.ts` when the custom-emoji channel pushed that file to its
 * 550-line budget. `MessageMedia` stays in `dto.ts` — a message's media is part
 * of the message domain — and imports `stickerFormatSchema` from here.
 */

/** The three sticker formats the client renders (design doc §9.4). */
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
 * One custom emoji's artwork, keyed by the id a `customEmoji` text entity carries.
 *
 * Telegram Premium's inline emoji are stickers rather than characters: the message
 * text keeps the base glyph (fallback, 复制, chat-list previews) and the entity
 * points at the art. TDLib answers `getCustomEmojiStickers` in arbitrary order and
 * only for the ids it knows, so every result carries its own id.
 */
export const customEmojiStickerSchema = z.object({
  /** TDLib int64 → string; see `MessageEntity.customEmojiId`. */
  customEmojiId: z.string(),
  sticker: stickerSchema,
})
export type CustomEmojiSticker = z.infer<typeof customEmojiStickerSchema>
