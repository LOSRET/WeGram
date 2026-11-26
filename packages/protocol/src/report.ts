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
  /**
   * With `textRequired`: TDLib's `is_optional` — the comment may be skipped, so the
   * sheet must not refuse to submit an empty one.
   */
  textOptional: z.boolean().optional(),
  /** Telegram wants messages picked, which the chat-level report cannot offer. */
  messagesRequired: z.boolean().optional(),
})
export type ChatReport = z.infer<typeof chatReportSchema>

/**
 * What a 举报 is about. It crosses IPC because 举报 is its own window since
 * 2026-11-27 — a Mini App's ⋯ card can report its bot without closing the app,
 * and the sheet has one home instead of living inside whichever window opened it.
 */
export const reportTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.number().int() }),
  z.object({ kind: z.literal('message'), chatId: z.number().int(), messageId: z.number().int() }),
])
export type ReportTarget = z.infer<typeof reportTargetSchema>

/** What the 举报 window draws: whose report it is, and the app's theme. */
export const reportWindowStateSchema = z.object({
  target: reportTargetSchema,
  theme: z.enum(['light', 'dark']),
})
export type ReportWindowState = z.infer<typeof reportWindowStateSchema>

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
  /**
   * Opens (or re-targets) the 举报 window on a target (design doc §9.9). The sheet
   * then asks the two channels above for the reasons: they are the TDLib calls.
   */
  'report:open',
  /** The window asks whose report it is, and the theme to paint. */
  'report:state',
  /** The window's own × / 关闭: it is frameless, so nothing native closes it. */
  'report:close',
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
  'report:open': {
    request: reportTargetSchema,
    response: z.void(),
  },
  'report:state': {
    request: z.void(),
    response: reportWindowStateSchema,
  },
  'report:close': {
    request: z.void(),
    response: z.void(),
  },
}
