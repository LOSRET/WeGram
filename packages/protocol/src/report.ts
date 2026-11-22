import { z } from 'zod'

/**
 * 举报 (`reportChat`): one phased contract for the two places Telegram lets a
 * client report — a person's 资料卡 (the private chat behind it) and one message
 * from the transcript's menu.
 *
 * TDLib answers in phases and the client must keep the reason id it was handed:
 * `reported: false` with `options` is "choose a reason", `textRequired` is "that
 * reason also wants a comment", and `reported: true` is the end of the road.
 * `messagesRequired` means Telegram wants specific messages instead of a chat;
 * the message path sends them, so that answer only remains reachable for a
 * chat-level report.
 *
 * Split out of `user.ts` when the per-message path arrived: the 资料卡's fields
 * are one reason to change and this phased state machine is another, and the
 * ids below (`optionId`) are TDLib `bytes` — base64 strings the client passes
 * back verbatim and never interprets.
 */

/** One answer of `reportChat`, as the 举报 sheet consumes it. */
export const chatReportSchema = z.object({
  reported: z.boolean(),
  /** The sheet's title for the reason list (TDLib supplies it per chat kind). */
  title: z.string().optional(),
  options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  /** The chosen reason wants a comment before the report can be filed. */
  textRequired: z.boolean().optional(),
  /**
   * With `textRequired`: the id the follow-up call must send along with the
   * comment. TDLib hands back a different one for that step, so it travels.
   */
  optionId: z.string().optional(),
  /** Telegram wants messages picked, which the chat-level report cannot offer. */
  messagesRequired: z.boolean().optional(),
})
export type ChatReport = z.infer<typeof chatReportSchema>

export const reportInvokeChannels = [
  /**
   * 举报 a person: the adapter resolves their private chat and reports that, so
   * a card opened from 通讯录 works too (`chats:openPrivate` semantics).
   */
  'users:report',
  /**
   * 举报 one message: the same phased `reportChat`, filed against its chat with
   * `message_ids` set. The context menu offers it only where TDLib's
   * `messageProperties.can_report_chat` allows it.
   */
  'messages:report',
] as const

export const reportInvokeSchemas = {
  'users:report': {
    request: z.object({
      userId: z.number().int(),
      optionId: z.string().optional(),
      /** The comment the chosen reason asks for, when it asks for one. */
      text: z.string().max(4000).optional(),
    }),
    response: chatReportSchema,
  },
  'messages:report': {
    request: z.object({
      chatId: z.number().int(),
      messageId: z.number().int(),
      optionId: z.string().optional(),
      /** The comment the chosen reason asks for, when it asks for one. */
      text: z.string().max(4000).optional(),
    }),
    response: chatReportSchema,
  },
}
