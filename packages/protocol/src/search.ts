import { z } from 'zod'

import { chatSummarySchema } from './chat'
import { messageSchema } from './dto'

/**
 * The cross-chat message search contract (design doc §9.2), split out of
 * `channels.ts` when that table hit its size budget.
 *
 * `chat` covers private chats and groups, `channel` covers channels; the adapter
 * asks TDLib for each chat type and merges the streams. `cursor` holds TDLib's
 * opaque per-stream offsets, and an empty offset means that stream is done.
 */
export const searchMessagesCursorSchema = z.object({
  private: z.string(),
  group: z.string(),
  channel: z.string(),
})

export type SearchMessagesCursor = z.infer<typeof searchMessagesCursorSchema>

export const searchMessagesRequestSchema = z.object({
  q: z.string().min(1),
  scope: z.enum(['chat', 'channel']),
  limit: z.number().int().positive().max(50),
  cursor: searchMessagesCursorSchema.optional(),
})

export const searchMessagesResponseSchema = z.object({
  messages: z.array(messageSchema),
  chats: z.array(chatSummarySchema),
  total: z.number().int(),
  cursor: searchMessagesCursorSchema,
})
