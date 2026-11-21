import { z } from 'zod'

import { chatInviteLinkSchema, chatMemberSchema, chatSummarySchema } from './chat'

/**
 * The 群二维码 window's IPC surface (design doc §9.9).
 *
 * WeChat opens the group's QR as its own small window, not a dialog inside the
 * chat; this is that window's contract. It lives beside `channels.ts` for the
 * same reason `chats.ts` does — the shared table is at its size budget.
 */

const noPayload = z.void()

/** Everything the window draws, fetched once when it mounts. */
export const qrInfoSchema = z.object({
  chat: chatSummarySchema,
  /** Faces for the collage above the title; a private chat answers with none. */
  members: z.array(chatMemberSchema),
  /** `null` = no link this account may share: the window says why instead of scanning nothing. */
  invite: chatInviteLinkSchema.nullable(),
  /** Painted from the first frame; the window follows the app's theme, not the OS. */
  theme: z.enum(['light', 'dark']),
})
export type QrInfo = z.infer<typeof qrInfoSchema>

export const qrInvokeChannels = [
  /** Opens (or re-targets) the window on a chat. */
  'qr:open',
  'qr:info',
  /** 复制图片: puts the rasterised PNG on the clipboard (main owns the bitmap). */
  'qr:copy',
  /** 保存图片: opens the native dialog and writes the PNG the window rasterised. */
  'qr:save',
  /** 转发给朋友: sends the QR as a photo message to the picked chat. */
  'qr:share',
  /** The window's own ×; it is frameless, so nothing native closes it. */
  'qr:close',
] as const

export const qrInvokeSchemas = {
  'qr:open': { request: z.object({ chatId: z.number().int() }), response: noPayload },
  'qr:info': { request: noPayload, response: qrInfoSchema },
  'qr:copy': { request: z.object({ png: z.string().min(1) }), response: noPayload },
  'qr:save': {
    request: z.object({ png: z.string().min(1) }),
    /** The saved path, or `null` when the reader cancelled the dialog. */
    response: z.object({ path: z.string() }).nullable(),
  },
  'qr:share': {
    request: z.object({ chatId: z.number().int(), png: z.string().min(1) }),
    response: noPayload,
  },
  'qr:close': { request: noPayload, response: noPayload },
}
