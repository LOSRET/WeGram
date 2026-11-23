import { z } from 'zod'

/**
 * 通讯录 (contacts) DTOs.
 *
 * Split out of `dto.ts` when the contact card landed: that file sits on its
 * size budget, and the address book is a self-contained concern.
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
  /** The Telegram号 row (the account's @username). */
  username: z.string().optional(),
  phone: z.string().optional(),
  /** Profile photo, when it was already cached when the list was mapped. */
  avatarUrl: z.string().optional(),
  /**
   * The data center the person lives on (1–5), read from the profile photo:
   * Telegram stores a user's picture on their own DC, which is the only DC
   * signal a client gets. Absent when the person has no photo, or when the
   * photo's remote id could not be read (see `tdlib/file-dc.ts`).
   */
  dcId: z.number().int().min(1).max(5).optional(),
})
export type Contact = z.infer<typeof contactSchema>
