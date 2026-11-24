import { z } from 'zod'

import { richBlockSchema } from './dto'

/**
 * 即时预览 — the in-app reader of a link's Instant View page (design doc §8.9).
 *
 * TDLib's `getWebPageInstantView` answers with the same `PageBlock` tree a rich
 * message uses, so the page is mapped into the rich-message union and drawn by the
 * one `RichMessage` renderer: the reader owns a frame and a header, not a second
 * block renderer.
 */

export const instantViewSchema = z.object({
  /** The page the blocks belong to; the reader can reopen it in a browser. */
  url: z.string(),
  blocks: z.array(richBlockSchema),
  /**
   * TDLib `webPageInstantView.is_full`: false when only the cached excerpt came
   * back. The adapter asks for the full page once before answering, so false here
   * means even that answer was partial.
   */
  isFull: z.boolean().optional(),
  /** TDLib `view_count`; absent when TDLib does not know it. */
  viewCount: z.number().int().nonnegative().optional(),
})
export type InstantView = z.infer<typeof instantViewSchema>

/** The card's opening argument: the page and the words the preview already knows. */
export const instantViewTargetSchema = z.object({
  url: z.string().min(1),
  /** The preview's title; TDLib's Instant View page carries none of its own. */
  title: z.string().optional(),
  /** The link's site name, shown under the title in the reader's header. */
  siteName: z.string().optional(),
})
export type InstantViewTarget = z.infer<typeof instantViewTargetSchema>

/** What the reader window reads on boot (`web:state`). */
export const instantViewWindowStateSchema = instantViewTargetSchema.extend({
  /** Painted from the first frame; the window follows the app's theme. */
  theme: z.enum(['light', 'dark']),
})
export type InstantViewWindowState = z.infer<typeof instantViewWindowStateSchema>


export const webInvokeChannels = [
  /**
   * 即时预览 opens the reader window (design doc §8.9), re-targeting it when it is
   * already open.
   */
  'web:open',
  /** The page the reader window was opened with; only that window calls it. */
  'web:state',
  /**
   * The Instant View page of a link, as rich blocks. A page without one — or an
   * unreachable one — throws an `AppError`; the reader reports it and offers the
   * browser instead.
   */
  'web:instantView',
] as const

const noPayload = z.void()

export const webInvokeSchemas = {
  'web:open': { request: instantViewTargetSchema, response: noPayload },
  'web:state': { request: noPayload, response: instantViewWindowStateSchema },
  'web:instantView': {
    request: z.object({ url: z.string().min(1) }),
    response: instantViewSchema,
  },
}
