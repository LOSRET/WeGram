import { z } from 'zod'

/**
 * 通讯录 (contacts) DTOs.
 *
 * Split out of `dto.ts` when the contact card landed: that file sits on its
 * 550-line budget, and the card's identity block is a self-contained concern.
 *
 * The chat summary already carries the title and the photo; this adds the
 * Telegram identity behind it (username / phone), which only `getUser` knows.
 * Absent fields mean the account does not expose them — Telegram hides phone
 * numbers of people who are not in the viewer's address book.
 */
export const contactProfileSchema = z.object({
  chatId: z.number().int(),
  /** Telegram user id of the peer, when the chat is a private conversation. */
  userId: z.number().int().optional(),
  username: z.string().optional(),
  phone: z.string().optional(),
})
export type ContactProfile = z.infer<typeof contactProfileSchema>
