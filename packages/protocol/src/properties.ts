import { z } from 'zod'

/**
 * The per-message capabilities TDLib answers through `getMessageProperties`.
 *
 * The context menu asks when it opens instead of deriving 编辑/转发/删除 from
 * `outgoing` and `kind`: TDLib owns the 48-hour edit window, protected content,
 * per-chat rights, the delete-for-me vs delete-for-everyone split, whether speech
 * can be recognised and whether the row may be pinned.
 *
 * Split out of `dto.ts` when 转文字 and 置顶 pushed that file over its 550-line
 * budget: the capability question is its own domain, and only the menu reads it.
 */
export const messagePropertiesSchema = z.object({
  canBeEdited: z.boolean(),
  canBeForwarded: z.boolean(),
  canBeDeletedOnlyForSelf: z.boolean(),
  canBeDeletedForAllUsers: z.boolean(),
  canBeCopied: z.boolean(),
  canBeReplied: z.boolean(),
  /** 转文字: TDLib `can_recognize_speech` (voice notes only, and not always). */
  canRecognizeSpeech: z.boolean().optional(),
  /** 置顶: TDLib `can_be_pinned` (the chat's pin right, protected content). */
  canBePinned: z.boolean().optional(),
  /** 举报: TDLib `can_report_chat` — the message may be reported to moderators. */
  canReportChat: z.boolean().optional(),
})
export type MessageProperties = z.infer<typeof messagePropertiesSchema>
