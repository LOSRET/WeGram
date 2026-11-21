import { z } from 'zod'

import { messageSchema } from './dto'

/**
 * The comment-thread contract (design doc §9.8).
 *
 * TDLib keeps a post's comments in a *different* chat — the channel's linked
 * discussion group — so every call here names the commented message's chat and
 * id and lets the adapter resolve the thread itself.
 *
 * These schemas were inline in `channels.ts` while the main process declared the
 * same six shapes by hand; a field added on one side did not reach the other and
 * nothing failed. They live here now and the adapter imports the types.
 */

export const commentTargetSchema = z.object({
  /** Chat of the commented message: a channel, or the discussion group itself. */
  chatId: z.number().int(),
  /** The commented message; TDLib resolves the thread, including the linked group. */
  messageId: z.number().int(),
})
export type CommentTarget = z.infer<typeof commentTargetSchema>

export const commentQuerySchema = commentTargetSchema.extend({
  /** Oldest comment already loaded; omit for the newest page. */
  fromMessageId: z.number().int().optional(),
  limit: z.number().int().positive().max(100),
})
export type CommentQuery = z.infer<typeof commentQuerySchema>

export const commentPageSchema = z.object({
  messages: z.array(messageSchema),
  hasMore: z.boolean(),
})
export type CommentPage = z.infer<typeof commentPageSchema>

export const commentAccessSchema = z.object({
  /** The composer may be used right now. */
  canComment: z.boolean(),
  /** The account is a member of the discussion group. */
  joined: z.boolean(),
  /** A join button is the way forward (not a member, and not banned). */
  canJoin: z.boolean(),
  /** The group approves joins manually, so the button says 申请加入. */
  joinByRequest: z.boolean(),
  /** Seconds left on slow mode before another comment may be sent. */
  slowModeSeconds: z.number().int().nonnegative(),
})
export type CommentAccess = z.infer<typeof commentAccessSchema>

export const commentJoinResultSchema = z.object({
  /** The account is in the group now. */
  joined: z.boolean(),
  /** A join request was sent and waits for an administrator. */
  requestSent: z.boolean(),
})
export type CommentJoinResult = z.infer<typeof commentJoinResultSchema>

/**
 * What to post into a thread (§9.8).
 *
 * The comment box is the chat composer's own card, so a comment is not always a
 * line of text: the 表情 panel posts a sticker and the attach menu hands over a
 * local file, exactly as they do in a chat. A photo or a document is the one
 * payload that still lives in the thread's discussion group, which is why the
 * adapter — not the renderer — resolves where it goes.
 */
export const commentContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1) }),
  z.object({ kind: z.literal('sticker'), fileId: z.number().int() }),
  z.object({
    kind: z.literal('media'),
    filePath: z.string().min(1),
    mediaKind: z.enum(['photo', 'file']),
    caption: z.string().optional(),
  }),
])
export type CommentContent = z.infer<typeof commentContentSchema>

export const commentSendSchema = commentTargetSchema.extend({
  /** Comment id being answered; omitted posts at the thread root. */
  replyTo: z.number().int().optional(),
  content: commentContentSchema,
})
export type CommentSendQuery = z.infer<typeof commentSendSchema>

export const commentSentSchema = z.object({ message: messageSchema })
