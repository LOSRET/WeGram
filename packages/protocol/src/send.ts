import { z } from 'zod'

/**
 * Outgoing-message control: the two channels that act on a message *after* the
 * send request rather than producing one.
 *
 * Split out of `channels.ts` when that table reached its line budget. Both are
 * message-domain channels but neither fits the send/edit/delete row set: typing is
 * transient presence, and a resend acts on a message TDLib already refused.
 */

export const sendInvokeChannels = [
  /**
   * 对方正在输入. Sent while composing (the renderer throttles); `false` cancels
   * the peer's indicator when the box empties, the message is sent or the field
   * loses focus.
   */
  'messages:typing',
  /**
   * 重试 a message TDLib marked `messageSendingStateFailed` with `can_retry`.
   * The adapter calls `resendMessages`; the resulting states arrive as ops.
   */
  'messages:resend',
] as const

export const sendInvokeSchemas = {
  'messages:typing': {
    request: z.object({ chatId: z.number().int(), typing: z.boolean() }),
    response: z.void(),
  },
  'messages:resend': {
    request: z.object({
      chatId: z.number().int(),
      messageIds: z.array(z.number().int()).min(1),
    }),
    response: z.void(),
  },
}
