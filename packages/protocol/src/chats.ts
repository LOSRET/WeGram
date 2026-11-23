import { z } from 'zod'

import {
  chatInviteLinkSchema,
  chatJoinResultSchema,
  chatJoinStateSchema,
  chatMemberSchema,
  chatPinnedMessageSchema,
  chatSummarySchema,
} from './chat'

/**
 * The chat domain's IPC surface (design doc §6; the 聊天信息 rows are §9.9).
 *
 * It sits beside `channels.ts` instead of inside it because that file is the one
 * protocol table and had reached its size budget. These keys partition
 * cleanly — the list, opening a chat, its settings and its member grid — so they
 * are the first domain to move: a new chat channel now costs a row here instead
 * of another line in the shared table.
 */

const noPayload = z.void()

export const chatInvokeChannels = [
  'chats:list',
  /**
   * 头像按需: the rows the conversation list is actually showing. The adapter's
   * photo pool only prefetches the page it was handed, so a chat that appears
   * without an upsert (a row paged in as the reader reaches the end) would keep
   * its initials. The finished photos arrive as ordinary `chats` upsert ops.
   */
  'chats:prefetchAvatars',
  'chats:get',
  'chats:open',
  /** Opens (creating if needed) the private chat of a contact card's user. */
  'chats:openPrivate',
  /**
   * The chat behind an `@username` mention: `searchPublicChat` resolves the name,
   * and a username nobody owns is an `AppError` to report, not a crash.
   */
  'chats:openUsername',
  /**
   * Whether this account may post in the chat. Only channels ask: posting there
   * is an administrator right, so the composer is offered only when it holds.
   */
  'chats:canPost',
  /**
   * Whether this account may read the chat's member list. A channel's subscribers
   * are administrator-only, so the 聊天信息 panel asks before drawing the grid.
   */
  'chats:canGetMembers',
  /**
   * 频道底栏: whether this account belongs to the channel and whether joining
   * would file a request. A channel opened from 搜索 / an `@username` is only a
   * preview until the account joins it.
   */
  'chats:joinState',
  /** 加入 / 申请加入: subscribes to the channel the bar is previewing. */
  'chats:join',
  /** 静音 / 取消静音 for the channel bar; answers the refreshed summary. */
  'chats:setMuted',
  /** 置顶聊天 / 取消置顶; answers the refreshed summary (sorted by the renderer). */
  'chats:setPinned',
  /**
   * 归档聊天 / 取消归档: TDLib moves the chat between `chatListArchive` and
   * `chatListMain` (`addChatToList`); the answer is the refreshed summary, whose
   * `archived` flag tells the renderer which list holds the row.
   */
  'chats:setArchived',
  /** 清空聊天记录: removes this account's copy of the history, not the peers'. */
  'chats:clearHistory',
  /**
   * 删除聊天: WeChat's local removal. TDLib `deleteChatHistory` with
   * `remove_from_chat_list: true` and `revoke: false` — never `deleteChat`,
   * which would delete the history for every member.
   */
  'chats:delete',
  /** 标为未读 / 标为已读, TDLib `toggleChatIsMarkedAsUnread`; answers the row. */
  'chats:setUnread',
  /** The 聊天信息 panel's member grid; private chats answer with an empty list. */
  'chats:members',
  /** 群聊名称: renames the group (TDLib `setChatTitle`). */
  'chats:setTitle',
  /** 退出群聊: removes this account from the group's members. */
  'chats:leave',
  /** 群公告: the newest pinned message, or `null` when nothing is pinned. */
  'chats:pinned',
  /**
   * 置顶消息 / 取消置顶. `messageId: null` unpins whatever is pinned, so the bar's
   * × does not have to remember the id. Answers the chat's pin afterwards.
   */
  'chats:setPinnedMessage',
  /** 群二维码: a public t.me link or a link this account may create. */
  'chats:inviteLink',
] as const

export const chatInvokeSchemas = {
  'chats:list': {
    request: z.object({
      limit: z.number().int().positive().max(200),
      offset: z.number().int().nonnegative(),
      /**
       * `archive` is TDLib's second chat list. The entry row above the
       * conversation list is fed from it, so the shell loads both lists at start-up.
       */
      list: z.enum(['main', 'archive']).optional(),
    }),
    response: z.array(chatSummarySchema),
  },
  'chats:prefetchAvatars': {
    // One screen of rows; a jump can ask for a little more than one window.
    request: z.object({ chatIds: z.array(z.number().int()).min(1).max(64) }),
    response: noPayload,
  },
  'chats:get': { request: z.object({ chatId: z.number().int() }), response: chatSummarySchema },
  'chats:open': { request: z.object({ chatId: z.number().int() }), response: noPayload },
  'chats:openPrivate': {
    request: z.object({ userId: z.number().int() }),
    response: chatSummarySchema,
  },
  'chats:openUsername': {
    // The @ is optional: a click hands over the mention's own words either way.
    request: z.object({ username: z.string().trim().min(1).max(64) }),
    response: chatSummarySchema,
  },
  'chats:canPost': { request: z.object({ chatId: z.number().int() }), response: z.boolean() },
  'chats:canGetMembers': {
    request: z.object({ chatId: z.number().int() }),
    response: z.boolean(),
  },
  'chats:joinState': {
    request: z.object({ chatId: z.number().int() }),
    response: chatJoinStateSchema,
  },
  'chats:join': {
    request: z.object({ chatId: z.number().int() }),
    response: chatJoinResultSchema,
  },
  'chats:setMuted': {
    request: z.object({ chatId: z.number().int(), muted: z.boolean() }),
    response: chatSummarySchema,
  },
  'chats:setPinned': {
    request: z.object({ chatId: z.number().int(), pinned: z.boolean() }),
    response: chatSummarySchema,
  },
  'chats:setArchived': {
    request: z.object({ chatId: z.number().int(), archived: z.boolean() }),
    response: chatSummarySchema,
  },
  /** `revoke: false` on purpose — WeChat's 清空聊天记录 clears this account's copy. */
  'chats:clearHistory': { request: z.object({ chatId: z.number().int() }), response: noPayload },
  /** 删除聊天 is local to this account: the peers keep their history (§5.4). */
  'chats:delete': { request: z.object({ chatId: z.number().int() }), response: noPayload },
  'chats:setUnread': {
    request: z.object({ chatId: z.number().int(), unread: z.boolean() }),
    response: chatSummarySchema,
  },
  'chats:members': {
    request: z.object({
      chatId: z.number().int(),
      limit: z.number().int().positive().max(50).optional(),
      /** 搜索群成员: passed to `searchChatMembers` instead of filtering one page. */
      query: z.string().optional(),
    }),
    response: z.array(chatMemberSchema),
  },
  'chats:setTitle': {
    request: z.object({ chatId: z.number().int(), title: z.string().trim().min(1).max(128) }),
    response: chatSummarySchema,
  },
  'chats:leave': { request: z.object({ chatId: z.number().int() }), response: noPayload },
  'chats:pinned': {
    request: z.object({ chatId: z.number().int() }),
    response: chatPinnedMessageSchema.nullable(),
  },
  'chats:setPinnedMessage': {
    request: z.object({ chatId: z.number().int(), messageId: z.number().int().nullable() }),
    response: chatPinnedMessageSchema.nullable(),
  },
  'chats:inviteLink': {
    request: z.object({
      chatId: z.number().int(),
      /** Ask for a fresh 7-day link (群二维码's temporary code), not a permanent one. */
      temporary: z.boolean().optional(),
    }),
    /** `null` when this account may neither see nor create one. */
    response: chatInviteLinkSchema.nullable(),
  },
}
