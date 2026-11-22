import { z } from 'zod'

import { messageInteractionSchema, messageSchema } from './dto'

/**
 * One patch against a loaded transcript (`evt:messages`).
 *
 * Split out of `dto.ts` when that file reached its 550-line budget. The set grows
 * with every TDLib update the app honours, so it is the part of the DTO layer most
 * likely to change; `Message` itself (the shape an op carries) stays in `dto.ts`.
 */
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
  /**
   * The sending state of one outgoing row moved (`updateMessageSendFailed` and
   * the failed answer of `sendMessage`). The row keeps its id; only the badge
   * changes, which is why this is a patch rather than a replacement.
   */
  z.object({
    op: z.literal('sendState'),
    chatId: z.number().int(),
    messageId: z.number().int(),
    sendingState: z.enum(['pending', 'failed']),
    sendError: z.string().optional(),
    canRetry: z.boolean().optional(),
  }),
  /**
   * TDLib replaced a pending message's id with the server one
   * (`updateMessageSendSucceeded.old_message_id`). The row is patched in place:
   * its position is already the reader's, and the new id is what edit / delete /
   * read receipts will use from now on.
   */
  z.object({
    op: z.literal('replaceId'),
    chatId: z.number().int(),
    oldId: z.number().int(),
    message: messageSchema,
  }),
  z.object({
    op: z.literal('interaction'),
    chatId: z.number().int(),
    messageId: z.number().int(),
    interaction: messageInteractionSchema.partial(),
  }),
])
export type MessageOp = z.infer<typeof messageOpSchema>
