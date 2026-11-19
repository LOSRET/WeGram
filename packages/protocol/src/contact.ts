import { z } from 'zod'

/**
 * 通讯录 (contacts) DTOs.
 *
 * Split out of `dto.ts` when the contact card landed: that file sits on its
 * 550-line budget, and the address book is a self-contained concern.
 *
 * A contact is a person from the account's Telegram address book
 * (`getContacts`), not a conversation: someone you never wrote to still has a
 * card, and the private chat is only created when 发消息 is pressed
 * (`chats:openPrivate`). Absent fields mean the account does not expose them —
 * Telegram hides phone numbers of people who are not in the viewer's address
 * book.
 */
export const contactSchema = z.object({
  /** Telegram user id; the card's 用户 ID row and the 发消息 request use it. */
  userId: z.number().int(),
  /** Display name the 通讯录 sorts and groups by (first + last name). */
  title: z.string(),
  /** The 微信号 row. */
  username: z.string().optional(),
  phone: z.string().optional(),
  /** Profile photo, when it was already cached when the list was mapped. */
  avatarUrl: z.string().optional(),
})
export type Contact = z.infer<typeof contactSchema>
