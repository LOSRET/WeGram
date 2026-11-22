import { z } from 'zod'

import { chatSummarySchema } from './chat'

/**
 * 资料卡 (the person card) and the writes it offers.
 *
 * Split out of `channels.ts` the way `presence.ts` was: this is a domain with its
 * own DTO, and `getUserFullInfo` answers a superset of what the contact row has.
 * The card is the same person Telegram's profile page describes — the 通讯录 row
 * and a private chat's header both open it.
 *
 * `note` is Telegram's cloud-synced 备注 (`setUserNote`), not a local remark: it
 * follows the account to every device, which is worth knowing before "clear the
 * cache" is expected to clear it.
 */
export const userProfileSchema = z.object({
  userId: z.number().int(),
  /** First + last name, the same display name the transcript uses. */
  title: z.string(),
  /** The Telegram号 (@username), when the account has one. */
  username: z.string().optional(),
  phone: z.string().optional(),
  /** Profile photo, when it was already on disk when the card was mapped. */
  avatarUrl: z.string().optional(),
  /** 简介 (TDLib `userFullInfo.bio`), plain text; absent when empty. */
  bio: z.string().optional(),
  /** 备注 (TDLib `userFullInfo.note`), plain text; absent when empty. */
  note: z.string().optional(),
  /** 共同群聊: TDLib `group_in_common_count`. 0 when there are none. */
  commonChats: z.number().int().nonnegative(),
  /** In this account's Telegram address book (`user.is_contact`). */
  isContact: z.boolean(),
  /** 已拉黑 (`userFullInfo.block_list` is not null). */
  blocked: z.boolean(),
})
export type UserProfile = z.infer<typeof userProfileSchema>

export const userInvokeChannels = [
  /** 资料卡: one `getUser` + `getUserFullInfo` pair, mapped into the card. */
  'users:profile',
  /** 备注: writes the cloud-side note and answers the refreshed card. */
  'users:setNote',
  /**
   * 添加为联系人 / 删除联系人 (`addContact` / `removeContacts`). Answers the
   * refreshed card, so the button flips without a second request.
   */
  'users:setContact',
  /** 拉黑 / 取消拉黑 (`setMessageSenderBlockList`); answers the refreshed card. */
  'users:setBlocked',
  /**
   * 共同群聊: the group chats this account has in common with one person
   * (TDLib `getGroupsInCommon`). The card asks only when the reader opens the
   * row, so a card that is merely glanced at costs no extra work.
   */
  'users:commonChats',
] as const

export const userInvokeSchemas = {
  'users:profile': {
    request: z.object({ userId: z.number().int() }),
    response: userProfileSchema,
  },
  'users:setNote': {
    request: z.object({ userId: z.number().int(), note: z.string().max(1000) }),
    response: userProfileSchema,
  },
  'users:setContact': {
    request: z.object({
      userId: z.number().int(),
      /** true = add to the address book, false = remove. */
      contact: z.boolean(),
      /** Ask Telegram to share our own number with them (添加联系人 offers it). */
      sharePhone: z.boolean().optional(),
    }),
    response: userProfileSchema,
  },
  'users:setBlocked': {
    request: z.object({ userId: z.number().int(), blocked: z.boolean() }),
    response: userProfileSchema,
  },
  /** 共同群聊: one page of TDLib `getGroupsInCommon`, as chat-list rows. */
  'users:commonChats': {
    request: z.object({
      userId: z.number().int(),
      /** TDLib's `offset_chat_id`: continue from this chat id; omit for the first page. */
      offset: z.number().int().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    response: z.array(chatSummarySchema),
  },
}
