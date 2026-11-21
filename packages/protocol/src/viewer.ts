import { z } from 'zod'

import { mediaSizeSchema } from './dto'
import { appSettingsSchema } from './settings'

/**
 * The standalone 图片和视频 window's payloads (design doc §9.5).
 *
 * Split out of `dto.ts` together with the settings block, when the comment /
 * interaction field pushed that file to its line budget.
 */

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
  /** A GIF-style animation: the canvas loops it instead of offering a transport. */
  isAnimation: z.boolean().optional(),
  fileName: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  size: z.number().int().nonnegative().optional(),
  /** TDLib `message.can_be_saved`; false blocks the viewer's 保存/复制. */
  canBeSaved: z.boolean().optional(),
  /** Seconds; lets the player show the total before the file has loaded. */
  duration: z.number().nonnegative().optional(),
  /** base64 JPEG, ~40px: paints the 预览 grid before a file has been fetched. */
  minithumbnail: z.string().optional(),
  /**
   * The bubble's thumbnail, painted sharp while the full picture downloads — the
   * official client upsizes the picture it already has instead of showing a
   * blank canvas, and this is the same idea.
   */
  thumbFileId: z.number().int().positive().optional(),
  /** Photo variants, smallest first; the window picks the one it will display. */
  sizes: z.array(mediaSizeSchema).optional(),
})
export type ViewerItem = z.infer<typeof viewerItemSchema>

/**
 * The strip the viewer pages through: at least one item, and never more than one
 * window should hold. Both `viewer:open` and `viewer:init` use this bound.
 */
export const viewerItemsSchema = z.array(viewerItemSchema).min(1).max(200)

/** What `viewer:init` answers: the strip, the current index and the theme. */
export const viewerStateSchema = z.object({
  items: viewerItemsSchema,
  index: z.number().int().nonnegative(),
  theme: appSettingsSchema.shape.theme,
})
export type ViewerState = z.infer<typeof viewerStateSchema>
