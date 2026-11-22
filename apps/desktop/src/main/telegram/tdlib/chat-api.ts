import type {
  ChatInviteLink,
  ChatJoinResult,
  ChatJoinState,
  ChatMember,
  ChatPinnedMessage,
  ChatSummary,
} from '@wegram/protocol'

import * as actions from './actions'
import type { ActionDeps } from './actions'

/**
 * The chat domain's adapter methods (design doc §6; 聊天信息 / 频道底栏 §9.9),
 * lifted out of `TdlibAdapter` when that class reached the 550-line budget with
 * the 频道底栏 work. Each function is the same delegation the class carried
 * inline; the class now binds this object instead of growing another method per
 * call, the way the mock adapter binds `createMockChats`.
 *
 * `getDeps` is a function on purpose: the class builds its fields before the
 * constructor has assigned `actionDeps`, so the lookup has to be deferred to the
 * first call.
 */
export interface ChatApiDeps {
  actionDeps: ActionDeps
  /** Our own user id, learnt from `getMe`; 发帖权限 and invite links need it. */
  getSelfUserId(): number | null
}

export interface TdlibChatApi {
  listChats(input: { limit: number; offset: number }): Promise<ChatSummary[]>
  getChat(chatId: number): Promise<ChatSummary>
  openChat(chatId: number): Promise<void>
  openPrivateChat(userId: number): Promise<ChatSummary>
  openUsernameChat(username: string): Promise<ChatSummary>
  canPost(chatId: number): Promise<boolean>
  canGetMembers(chatId: number): Promise<boolean>
  chatJoinState(chatId: number): Promise<ChatJoinState>
  joinChannel(chatId: number): Promise<ChatJoinResult>
  setChatMuted(chatId: number, muted: boolean): Promise<ChatSummary>
  setChatPinned(chatId: number, pinned: boolean): Promise<ChatSummary>
  clearHistory(chatId: number): Promise<void>
  deleteChat(chatId: number): Promise<void>
  setChatUnread(chatId: number, unread: boolean): Promise<ChatSummary>
  chatMembers(chatId: number, limit: number, query?: string): Promise<ChatMember[]>
  setChatTitle(chatId: number, title: string): Promise<ChatSummary>
  leaveChat(chatId: number): Promise<void>
  pinnedMessage(chatId: number): Promise<ChatPinnedMessage | null>
  inviteLink(chatId: number, temporary?: boolean): Promise<ChatInviteLink | null>
}

export function createChatApi(getDeps: () => ChatApiDeps): TdlibChatApi {
  const actionDeps = (): ActionDeps => getDeps().actionDeps
  return {
    listChats: (input) => actions.listChats(actionDeps(), input),
    getChat: (chatId) => actions.getChat(actionDeps(), chatId),
    openChat: (chatId) => actions.openChat(actionDeps(), chatId),
    openPrivateChat: (userId) => actions.openPrivateChat(actionDeps(), userId),
    openUsernameChat: (username) => actions.openUsernameChat(actionDeps(), username),
    canPost: (chatId) =>
      actions.canPost(
        { invoke: actionDeps().invoke, getSelfUserId: getDeps().getSelfUserId },
        chatId,
      ),
    canGetMembers: (chatId) => actions.canGetMembers(actionDeps(), chatId),
    chatJoinState: (chatId) => actions.chatJoinState(actionDeps(), chatId),
    joinChannel: (chatId) => actions.joinChannel(actionDeps(), chatId),
    setChatMuted: (chatId, muted) => actions.setChatMuted(actionDeps(), chatId, muted),
    setChatPinned: (chatId, pinned) => actions.setChatPinned(actionDeps(), chatId, pinned),
    clearHistory: (chatId) => actions.clearHistory(actionDeps(), chatId),
    deleteChat: (chatId) => actions.deleteChat(actionDeps(), chatId),
    setChatUnread: (chatId, unread) => actions.setChatUnread(actionDeps(), chatId, unread),
    chatMembers: (chatId, limit, query) => actions.listMembers(actionDeps(), chatId, limit, query),
    setChatTitle: (chatId, title) => actions.setChatTitle(actionDeps(), chatId, title),
    leaveChat: (chatId) => actions.leaveChat(actionDeps(), chatId),
    pinnedMessage: (chatId) => actions.pinnedMessage(actionDeps(), chatId),
    inviteLink: (chatId, temporary) =>
      actions.inviteLink(
        { ...actionDeps(), getSelfUserId: getDeps().getSelfUserId },
        chatId,
        temporary,
      ),
  }
}
