import { z } from 'zod'

import {
  chatInviteLinkSchema,
  chatMemberSchema,
  chatPinnedMessageSchema,
  chatSummarySchema,
} from './chat'

/**
 * The chat domain's IPC surface (design doc §6; the 聊天信息 rows are §9.9).
 *
 * It sits beside `channels.ts` instead of inside it because that file is the one
 * protocol table and had reached its 550-line budget. These keys partition
 * cleanly — the list, opening a chat, its settings and its member grid — so they
 * are the first domain to move: a new chat channel now costs a row here instead
 * of another line in the shared table.
 */

const noPayload = z.void()

export const chatInvokeChannels = [
  'chats:list',
  'chats:get',
  'chats:open',
  /** Opens (creating if needed) the private chat of a contact card's user. */
  'chats:openPrivate',
  /**
   * Whether this account may post in the chat. Only channels ask: posting there
   * is an administrator right, so the composer is offered only when it holds.
   */
  'chats:canPost',
  /** 静音 / 取消静音 for the channel bar; answers the refreshed summary. */
  'chats:setMuted',
  /** 置顶聊天 / 取消置顶; answers the refreshed summary (sorted by the renderer). */
  'chats:setPinned',
  /** 清空聊天记录: removes this account's copy of the history, not the peers'. */
  'chats:clearHistory',
  /** The 聊天信息 panel's member grid; private chats answer with an empty list. */
  'chats:members',
  /** 群聊名称: renames the group (TDLib `setChatTitle`). */
  'chats:setTitle',
  /** 退出群聊: removes this account from the group's members. */
  'chats:leave',
  /** 群公告: the newest pinned message, or `null` when nothing is pinned. */
  'chats:pinned',
  /** 群二维码: a public t.me link or a link this account may create. */
  'chats:inviteLink',
] as const

export const chatInvokeSchemas = {
  'chats:list': {
    request: z.object({
      limit: z.number().int().positive().max(200),
      offset: z.number().int().nonnegative(),
    }),
    response: z.array(chatSummarySchema),
  },
  'chats:get': { request: z.object({ chatId: z.number().int() }), response: chatSummarySchema },
  'chats:open': { request: z.object({ chatId: z.number().int() }), response: noPayload },
  'chats:openPrivate': {
    request: z.object({ userId: z.number().int() }),
    response: chatSummarySchema,
  },
  'chats:canPost': { request: z.object({ chatId: z.number().int() }), response: z.boolean() },
  'chats:setMuted': {
    request: z.object({ chatId: z.number().int(), muted: z.boolean() }),
    response: chatSummarySchema,
  },
  'chats:setPinned': {
    request: z.object({ chatId: z.number().int(), pinned: z.boolean() }),
    response: chatSummarySchema,
  },
  /** `revoke: false` on purpose — WeChat's 清空聊天记录 clears this account's copy. */
  'chats:clearHistory': { request: z.object({ chatId: z.number().int() }), response: noPayload },
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
