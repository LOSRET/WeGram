import { z } from 'zod'

import {
  chatInviteLinkSchema,
  chatJoinResultSchema,
  chatJoinStateSchema,
  chatMemberSchema,
  chatPinnedMessageSchema,
  chatSummarySchema,
} from './chat'
import { chatTopicSchema, topicCursorSchema, topicIconSchema, topicPageSchema } from './topic'

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
   * 添加成员: TDLib `addChatMembers` for one person resolved from an @username
   * (a bot is added exactly this way — it has no invite-link flow). Answers the
   * added member's id and name; a refusal is an `AppError` with the reader's words.
   */
  'chats:addMember',
  /**
   * 置顶消息 / 取消置顶. `messageId: null` unpins whatever is pinned, so the bar's
   * × does not have to remember the id. Answers the chat's pin afterwards.
   */
  'chats:setPinnedMessage',
  /** 群二维码: a public t.me link or a link this account may create. */
  'chats:inviteLink',
  /**
   * 话题列表 (design doc §9.12): one page of a forum's topics, newest activity
   * first, with TDLib's own cursor (date + last message + topic id). `query`
   * searches the topic names on the server.
   */
  'chats:topics',
  /** 新建话题: name + icon colour, permission-gated by `chats:canCreateTopic`. */
  'chats:topicCreate',
  /** 编辑话题: title and/or icon; answers nothing, the list refreshes on evt:topics. */
  'chats:topicEdit',
  /** 置顶话题 / 取消置顶. */
  'chats:topicSetPinned',
  /** 关闭话题 / 重新打开: a closed topic stays readable, only its creator may post. */
  'chats:topicSetClosed',
  /** 话题免打扰: TDLib's per-topic notification settings. */
  'chats:topicSetMuted',
  /** 话题图标: the custom emoji this account may use (getForumTopicDefaultIcons). */
  'chats:topicIcons',
  /**
   * 论坛的展示方式 (design doc §9.12): Telegram lets administrators show a forum's
   * topics as a sidebar (our default) or as tabs above the messages. TDLib keeps
   * the choice on `supergroupFullInfo`, not on the chat object.
   */
  'chats:forumLayout',
  /** 删除话题 (TDLib `deleteForumTopic`). */
  'chats:topicDelete',
  /** 复制话题链接: TDLib `getForumTopicLink`, `null` when it has none. */
  'chats:topicLink',
  /**
   * 以聊天方式查看 (TDLib `toggleChatViewAsTopics`): flips the forum's own view
   * setting, exactly like the official client's menu item. Answers the summary.
   */
  'chats:setViewAsTopics',
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
    request: z.object({
      chatId: z.number().int(),
      /** 话题 (design doc §9.12): a forum topic's own pin, when the pane is inside one. */
      topicId: z.number().int().positive().optional(),
    }),
    response: chatPinnedMessageSchema.nullable(),
  },
  'chats:setPinnedMessage': {
    request: z.object({
      chatId: z.number().int(),
      topicId: z.number().int().positive().optional(),
      messageId: z.number().int().nullable(),
    }),
    response: chatPinnedMessageSchema.nullable(),
  },
  'chats:addMember': {
    request: z.object({
      chatId: z.number().int(),
      /** The @username, with or without the '@' (a bot's handle is its only id). */
      username: z.string().trim().min(3).max(64),
    }),
    response: z.object({ userId: z.number().int(), title: z.string() }),
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
  'chats:topics': {
    request: z.object({
      chatId: z.number().int(),
      /** 搜索话题: TDLib searches the names, the page is then the first hit window. */
      query: z.string().max(128).optional(),
      /** The previous page's `next`; omitted for the first one. */
      cursor: topicCursorSchema.optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    response: topicPageSchema,
  },
  'chats:topicCreate': {
    request: z.object({
      chatId: z.number().int(),
      title: z.string().trim().min(1).max(128),
      /** 0xRRGGBB; TDLib accepts the six colours of `TOPIC_ICON_COLORS`. */
      iconColor: z.number().int().nonnegative().max(0xffffff),
      iconEmojiId: z.string().optional(),
    }),
    response: chatTopicSchema,
  },
  'chats:topicEdit': {
    request: z.object({
      chatId: z.number().int(),
      topicId: z.number().int().positive(),
      /** Absent keeps the current name; an empty string is rejected (TDLib keeps it). */
      title: z.string().trim().min(1).max(128).optional(),
      /**
       * The icon's custom emoji; `'0'` removes it. TDLib's `editForumTopic` can
       * only change this — the icon colour is fixed when the topic is created,
       * exactly like the official client's editor.
       */
      iconEmojiId: z.string().optional(),
    }),
    response: noPayload,
  },
  'chats:topicSetPinned': {
    request: z.object({
      chatId: z.number().int(),
      topicId: z.number().int().positive(),
      pinned: z.boolean(),
    }),
    response: noPayload,
  },
  'chats:topicSetClosed': {
    request: z.object({
      chatId: z.number().int(),
      topicId: z.number().int().positive(),
      closed: z.boolean(),
    }),
    response: noPayload,
  },
  'chats:topicSetMuted': {
    request: z.object({
      chatId: z.number().int(),
      topicId: z.number().int().positive(),
      muted: z.boolean(),
    }),
    response: noPayload,
  },
  'chats:topicIcons': {
    request: noPayload,
    response: z.object({ icons: z.array(topicIconSchema) }),
  },
  'chats:forumLayout': {
    request: z.object({ chatId: z.number().int() }),
    response: z.object({ layout: z.enum(['tabs', 'sidebar']) }),
  },
  'chats:topicDelete': {
    request: z.object({ chatId: z.number().int(), topicId: z.number().int().positive() }),
    response: noPayload,
  },
  'chats:topicLink': {
    request: z.object({ chatId: z.number().int(), topicId: z.number().int().positive() }),
    response: z.object({ link: z.string() }).nullable(),
  },
  'chats:setViewAsTopics': {
    request: z.object({ chatId: z.number().int(), viewAsTopics: z.boolean() }),
    response: chatSummarySchema,
  },
}
