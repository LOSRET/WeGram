import { z } from 'zod'

/**
 * The chat domain's DTOs (design doc §6; the 聊天信息 rows are §9.9).
 *
 * Split out of `dto.ts` when the panel's member and pinned-message schemas pushed
 * that file over its size budget. `channels.ts` and `chats.ts` import from
 * here; the renderer still sees every type through the package index.
 */

export const chatKindSchema = z.enum(['private', 'group', 'channel'])
export type ChatKind = z.infer<typeof chatKindSchema>

export const chatSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  kind: chatKindSchema,
  /** Peer user id (private/secret); 通讯录 hides our own Saved Messages. */
  userId: z.number().int().optional(),
  unread: z.number().int().nonnegative(),
  pinned: z.boolean(),
  muted: z.boolean(),
  /**
   * 已归档会话: TDLib keeps the Archive as a chat list of its own
   * (`chatListArchive`), not as a flag on the row, and a chat belongs to exactly
   * one of Main / Archive. The renderer routes an upsert by this field, so
   * archiving moves the row between two lists instead of sending a `remove` op
   * (which would drop the transcript with it).
   */
  archived: z.boolean().optional(),
  /**
   * 标为未读 (TDLib `chat.is_marked_as_unread`): a flag the reader sets by hand,
   * independent of the unread counter. The row draws a dot, not a count, and the
   * flag is cleared when the chat is opened.
   */
  markedUnread: z.boolean().optional(),
  lastMessageText: z.string().optional(),
  lastMessageAt: z.number().optional(),
  /** [start, end) spoiler runs of `lastMessageText`, so the row can mask them too. */
  lastMessageSpoilers: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
  /** Highest incoming message id the server considers read (unread divider). */
  lastReadInboxMessageId: z.number().int().optional(),
  /** Highest outgoing message id the peer has read (read receipt). */
  lastReadOutboxMessageId: z.number().int().optional(),
  /** `wx-media://` URL of the chat photo; filled in after it is downloaded. */
  avatarUrl: z.string().optional(),
  /**
   * 论坛群 (design doc §9.12): TDLib `chat.view_as_topics`. The client then shows
   * the topic list instead of one flat transcript, and every message carries the
   * topic it belongs to. A forum switched to "view as chats" on another device
   * arrives as `false`, which is honoured: the transcript is flat again.
   */
  forum: z.boolean().optional(),
  /**
   * 新建话题: TDLib `chat.permissions.can_create_topics`. The topic list's "+" is
   * drawn only when it holds (admins keep it through `can_manage_topics`).
   */
  canCreateTopic: z.boolean().optional(),
})
export type ChatSummary = z.infer<typeof chatSummarySchema>

/**
 * One participant in the 聊天信息 panel's member grid (design doc §9.9).
 *
 * Names come from the adapter's cache; `avatarUrl` is filled only when the photo
 * is already on disk, exactly like `ChatSummary.avatarUrl`. A picture that
 * finishes later arrives through `evt:avatars`, so the grid draws initials first
 * and gains faces without refetching the list.
 */
export const chatMemberSchema = z.object({
  userId: z.number().int(),
  title: z.string(),
  avatarUrl: z.string().optional(),
})
export type ChatMember = z.infer<typeof chatMemberSchema>

/**
 * 群公告: Telegram's newest pinned message, which is what a group uses for an
 * announcement. Only the row's preview crosses IPC — the panel shows the text and
 * the 定位 path fetches the row itself when the reader taps it.
 */
export const chatPinnedMessageSchema = z.object({
  messageId: z.number().int(),
  text: z.string(),
})
export type ChatPinnedMessage = z.infer<typeof chatPinnedMessageSchema>

/**
 * 群二维码's payload: the invite link a phone can open. `expiresAt` is Unix
 * seconds and only present for a temporary link (the 7-day QR the client draws);
 * a public username link never expires, so it carries no date.
 */
export const chatInviteLinkSchema = z.object({
  link: z.string(),
  expiresAt: z.number().int().optional(),
})
export type ChatInviteLink = z.infer<typeof chatInviteLinkSchema>

/**
 * 频道底栏: whether this account belongs to the channel, and how joining would go
 * (design doc §9.9).
 *
 * A channel reached from 搜索 or an `@username` can be read without being
 * subscribed, so "the transcript is open" says nothing about membership. The
 * bar asks once per channel and draws 加入 instead of 静音 until the account
 * joins — muting a channel one has not joined is a lie.
 */
export const chatJoinStateSchema = z.object({
  /** A subscriber: creator, administrator, member — or a restricted member. */
  joined: z.boolean(),
  /** `joinChat` files an administrator's request instead of adding the account. */
  byRequest: z.boolean(),
})
export type ChatJoinState = z.infer<typeof chatJoinStateSchema>

/**
 * The answer of 加入 / 申请加入 (design doc §9.9).
 *
 * Deliberately the same two flags as `CommentJoinResult`: the chat domain keeps
 * its own row so `chats.ts` does not import the comment module for a shape that
 * is only coincidentally the same.
 */
export const chatJoinResultSchema = z.object({
  /** The account is a subscriber now. */
  joined: z.boolean(),
  /** The server took a request: the bar waits for an administrator. */
  requestSent: z.boolean(),
})
export type ChatJoinResult = z.infer<typeof chatJoinResultSchema>

export const chatOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('upsert'), chat: chatSummarySchema }),
  z.object({ op: z.literal('remove'), chatId: z.number().int() }),
])
export type ChatOp = z.infer<typeof chatOpSchema>
