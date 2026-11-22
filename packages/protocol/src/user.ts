import { z } from 'zod'

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

/**
 * One answer of `reportChat`, as the card's 举报 sheet consumes it.
 *
 * TDLib answers in phases and the client must keep the reason id it was handed:
 * `reported: false` with `options` is "choose a reason", `textRequired` is "that
 * reason also wants a comment", and `reported: true` is the end of the road.
 * `messagesRequired` means Telegram wants specific messages instead of a chat —
 * that is a per-message path this client does not offer yet.
 */
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
  /** Telegram wants messages picked, which this client does not offer. */
  messagesRequired: z.boolean().optional(),
})
export type ChatReport = z.infer<typeof chatReportSchema>

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
   * 举报 (`reportChat`), which TDLib answers in phases: the first call names the
   * reasons, a second one carries the chosen reason (and the comment Telegram may
   * ask for). See `ChatReport`.
   */
  'users:report',
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
  /**
   * 举报. `optionId` is a TDLib `bytes` value that came back from a previous step,
   * kept verbatim as a base64 string: it identifies a reason **and** whether that
   * reason still wants a comment, so it must not be interpreted by the client.
   */
  'users:report': {
    request: z.object({
      userId: z.number().int(),
      optionId: z.string().optional(),
      /** The comment the chosen reason asks for, when it asks for one. */
      text: z.string().max(4000).optional(),
    }),
    response: chatReportSchema,
  },
}
