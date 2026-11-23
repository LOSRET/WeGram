import { AppError } from '@wegram/protocol'
import type {
  ChatInviteLink,
  ChatJoinResult,
  ChatJoinState,
  ChatMember,
  ChatSummary,
} from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import { mapChat } from '../map/chat'
import { chatPlacement } from '../map/placement'
import type { ActionDeps, PostPermissionDeps } from './deps'

export async function fetchChatSummary(deps: ActionDeps, chatId: number): Promise<ChatSummary> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  return mapChat(deps.mapper, chat)
}

export async function getChat(deps: ActionDeps, chatId: number): Promise<ChatSummary> {
  return fetchChatSummary(deps, chatId)
}

export async function listChats(
  deps: ActionDeps,
  input: { limit: number; offset: number; list?: 'main' | 'archive' },
): Promise<ChatSummary[]> {
  // TDLib has no offset for getChats: fetch enough ids and slice (§6.3). The
  // Archive is a chat list of its own, so one rule pages both lists.
  const response = await deps.invoke({
    _: 'getChats',
    chat_list: { _: input.list === 'archive' ? 'chatListArchive' : 'chatListMain' },
    limit: input.offset + input.limit,
  })
  const ids: number[] = asArray<number>(response.chat_ids)
  const page = ids.slice(input.offset, input.offset + input.limit)
  const summaries = await Promise.all(page.map((id) => fetchChatSummary(deps, id)))
  // Photos come second: the rows must not wait for one network round trip per
  // chat, so they are downloaded in the background and pushed as `chats` ops.
  deps.prefetchChatAvatars(page)
  return summaries
}

/**
 * The reader opened the conversation.
 *
 * Opening must NOT mark it read. Reading is reported per viewport by
 * `messages:read` (gated by the renderer's `lib/readGate.ts`, 350 ms debounce)
 * and moves the server marker one screen at a time. Marking everything read here
 * undid that rule on the only path that matters — a click: a group with 300
 * unread messages went to zero before the transcript had even landed on its
 * "以下是新消息" line, so the badge, the rail total and every other device said
 * "read" while the reader was still looking at the unread block, and the chat
 * reopened on a divider that no longer meant anything.
 *
 * What is left is the warm-up: `getChat` loads the chat into TDLib's cache, which
 * is what the history request that follows reads from. (The newest id cannot be
 * taken from a history page in any case: `getChatHistory` treats
 * `from_message_id` as *exclusive*, measured 2026-11-17.)
 */
export async function openChat(deps: ActionDeps, chatId: number): Promise<void> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  /**
   * 标为未读 is a flag the reader set by hand, and opening the chat consumes it —
   * WeChat clears its red dot the same way. Reading itself still moves the server
   * marker one viewport at a time through `messages:read` (see above), so this
   * call only touches the flag, never `unread_count`.
   */
  if (!chat?.is_marked_as_unread) return
  await deps.invoke({
    _: 'toggleChatIsMarkedAsUnread',
    chat_id: chatId,
    is_marked_as_unread: false,
  })
  const summary = await fetchChatSummary(deps, chatId)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
}

/**
 * 发消息 on a contact card: TDLib creates the private chat on first use and
 * answers with it. The summary is pushed as an upsert too, so the row exists in
 * the renderer's list before the pane mounts — the same contract as
 * `openUsernameChat`.
 */
export async function openPrivateChat(deps: ActionDeps, userId: number): Promise<ChatSummary> {
  const raw = await deps.invoke({ _: 'createPrivateChat', user_id: userId, force: false })
  const summary = mapChat(deps.mapper, raw)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
  return summary
}

/**
 * The chat behind an @username mention (design doc §8.3).
 *
 * TDLib has no "open by username": the name is first resolved with
 * `searchPublicChat`, which answers the chat for a user, a group or a channel.
 * A name nobody owns is what a stale mention in an old message looks like — it
 * crosses IPC as an `AppError` carrying a Chinese sentence, so the renderer can
 * toast it instead of opening a blank conversation.
 */
export async function openUsernameChat(deps: ActionDeps, input: string): Promise<ChatSummary> {
  const username = input.trim().replace(/^@+/, '')
  if (!username) throw new AppError('invalid_payload', '缺少用户名')
  let raw: TdObject
  try {
    raw = await deps.invoke({ _: 'searchPublicChat', username })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/USERNAME_NOT_OCCUPIED|USERNAME_INVALID|USERNAME_PURCHASE_AVAILABLE/.test(message)) {
      throw new AppError('invalid_payload', `找不到 @${username} 这个用户名`)
    }
    throw error
  }
  // The summary is also pushed, so the row exists in the renderer's list before
  // the pane mounts — the same contract as `openPrivateChat` on the adapter.
  const summary = mapChat(deps.mapper, raw)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
  return summary
}

/** TDLib's "muted forever"; `mute_for` is a signed 32-bit seconds field. */
const MUTE_FOREVER = 2_147_483_647

/**
 * Whether this account may post in a chat.
 *
 * Only channels need the question: groups and private chats always keep the
 * composer, because a server-side restriction surfaces as an `AppError` on send.
 * Channel posting, on the other hand, is an administrator right that TDLib keeps
 * on the member object — `chat.permissions` describes *non-administrators* — so
 * the current user's own membership has to be asked for.
 */
export async function canPost(deps: PostPermissionDeps, chatId: number): Promise<boolean> {
  const userId = deps.getSelfUserId()
  if (userId === null) return false
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const type = chat?.type
  if (type?._ !== 'chatTypeSupergroup' || !type.is_channel) return true
  const member = await deps.invoke({
    _: 'getChatMember',
    chat_id: chatId,
    member_id: { _: 'messageSenderUser', user_id: userId },
  })
  const status = member?.status
  if (status?._ === 'chatMemberStatusCreator') return true
  if (status?._ === 'chatMemberStatusAdministrator') {
    return Boolean(status.rights?.can_post_messages)
  }
  return false
}

/**
 * Whether this account may read the chat's member list (管理员显示群成员).
 *
 * The 聊天信息 panel draws its member grid for groups; a channel exposes its
 * subscribers to administrators only. TDLib's own gate for that is
 * `supergroupFullInfo.can_get_members` — the same flag that lets
 * `searchChatMembers` answer — so the panel asks once instead of drawing an
 * empty grid for every subscriber. A basic group's member table is readable by
 * its members, and a private chat has none.
 */
export async function canGetMembers(deps: ActionDeps, chatId: number): Promise<boolean> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const type = chat?.type
  if (type?._ === 'chatTypeBasicGroup') return true
  if (type?._ !== 'chatTypeSupergroup') return false
  try {
    const info = await deps.invoke({
      _: 'getSupergroupFullInfo',
      supergroup_id: type.supergroup_id,
    })
    return Boolean(info?.can_get_members)
  } catch {
    // A supergroup whose full info is not cached yet is not an answer; the panel
    // simply keeps the grid closed and asks again the next time it opens.
    return false
  }
}

/** chatMemberStatus* → "this account belongs to the chat". */
function statusIsMember(status: TdObject | undefined): boolean {
  switch (status?._) {
    case 'chatMemberStatusCreator':
    case 'chatMemberStatusAdministrator':
    case 'chatMemberStatusMember':
      return true
    case 'chatMemberStatusRestricted':
      // A restricted member is still a member; joining is not the next step.
      return Boolean(status.is_member)
    default:
      // chatMemberStatusLeft / chatMemberStatusBanned / no status at all.
      return false
  }
}

/**
 * 频道底栏: whether this account belongs to the channel, and how joining would go.
 *
 * A channel reached from 搜索 or an `@username` is readable without being
 * subscribed, so the bar cannot infer membership from "the chat is open". TDLib
 * keeps the current user's own status on the supergroup (the same field
 * `commentInfo` reads for groups) and `join_by_request` decides 加入 vs 申请加入.
 */
export async function chatJoinState(deps: ActionDeps, chatId: number): Promise<ChatJoinState> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const type = chat?.type
  if (type?._ !== 'chatTypeSupergroup' || !type.is_channel) {
    return { joined: true, byRequest: false }
  }
  const supergroup = await deps.invoke({
    _: 'getSupergroup',
    supergroup_id: type.supergroup_id,
  })
  return {
    joined: statusIsMember(supergroup?.status),
    byRequest: Boolean(supergroup?.join_by_request),
  }
}

/**
 * 加入频道 / 申请加入 (design doc §9.9).
 *
 * TDLib answers with a join *result*, not with the membership: a public channel
 * subscribes at once, while a request-based one only files the request an
 * administrator must approve — the two states the bar draws.
 */
export async function joinChannel(deps: ActionDeps, chatId: number): Promise<ChatJoinResult> {
  const result = await deps.invoke({ _: 'joinChat', chat_id: chatId })
  switch (result?._) {
    case 'chatJoinResultSuccess':
      return { joined: true, requestSent: false }
    case 'chatJoinResultRequestSent':
      return { joined: false, requestSent: true }
    case 'chatJoinResultGuardBotApprovalRequired':
      throw new AppError('not_implemented', '这个频道需要通过机器人验证才能加入')
    default:
      throw new AppError('internal', '加入频道失败')
  }
}

/**
 * Mutes or unmutes a chat.
 *
 * TDLib has no mute toggle: `setChatNotificationSettings` replaces the whole
 * object, so the stored settings are read back and only the mute pair is
 * changed — otherwise toggling mute would also reset sounds and previews.
 */
export async function setChatMuted(
  deps: ActionDeps,
  chatId: number,
  muted: boolean,
): Promise<ChatSummary> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const settings = chat?.notification_settings
  if (!settings) throw new AppError('internal', `Chat ${chatId} has no notification settings`)
  await deps.invoke({
    _: 'setChatNotificationSettings',
    chat_id: chatId,
    notification_settings: {
      ...settings,
      use_default_mute_for: false,
      mute_for: muted ? MUTE_FOREVER : 0,
    },
  })
  const summary = await fetchChatSummary(deps, chatId)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
  return summary
}

/**
 * 置顶聊天 / 取消置顶 (design doc §9.9).
 *
 * TDLib keeps the pinned flag on the chat's *position* in a chat list, not on the
 * chat itself, and each list keeps its own pin — so the call has to name the list
 * the chat is actually in, or pinning an archived chat would do nothing.
 * Telegram caps the pinned count; the refusal crosses IPC as an `AppError` and
 * the switch stays where it was.
 */
export async function setChatPinned(
  deps: ActionDeps,
  chatId: number,
  pinned: boolean,
): Promise<ChatSummary> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const { archived } = chatPlacement(chat)
  await deps.invoke({
    _: 'toggleChatIsPinned',
    chat_list: { _: archived ? 'chatListArchive' : 'chatListMain' },
    chat_id: chatId,
    is_pinned: pinned,
  })
  const summary = await fetchChatSummary(deps, chatId)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
  return summary
}

/**
 * 归档聊天 / 取消归档 (design doc §9.2).
 *
 * TDLib has no archive flag: the Archive is a chat list, and `addChatToList`
 * moves the chat between Main and Archive — a chat cannot be in both, and TDLib
 * removes it from the other list itself.
 *
 * One case needs a companion call: a chat TDLib archived by itself (a message
 * from a non-contact) carries `can_unarchive` on its action bar, and moving it
 * back to Main without resetting its notification settings would let the server
 * file it away again.
 */
export async function setChatArchived(
  deps: ActionDeps,
  chatId: number,
  archived: boolean,
): Promise<ChatSummary> {
  if (!archived) {
    const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
    if (chat?.action_bar?.can_unarchive === true) {
      const settings = chat.notification_settings
      if (settings) {
        await deps.invoke({
          _: 'setChatNotificationSettings',
          chat_id: chatId,
          notification_settings: { ...settings, use_default_mute_for: true, mute_for: 0 },
        })
      }
    }
  }
  await deps.invoke({
    _: 'addChatToList',
    chat_id: chatId,
    chat_list: { _: archived ? 'chatListArchive' : 'chatListMain' },
  })
  const summary = await fetchChatSummary(deps, chatId)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
  return summary
}

/**
 * 清空聊天记录, the way WeChat means it: the history disappears for this account
 * only. `revoke: false` is deliberate — `revoke: true` would delete the peers'
 * copy as well in the chats where Telegram allows it.
 *
 * The refreshed summary (no last message) is pushed so the chat row loses its
 * preview; the transcript is cleared by the renderer that asked.
 */
export async function clearHistory(deps: ActionDeps, chatId: number): Promise<void> {
  await deps.invoke({
    _: 'deleteChatHistory',
    chat_id: chatId,
    remove_from_chat_list: false,
    revoke: false,
  })
  const summary = await fetchChatSummary(deps, chatId)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
}

/**
 * 删除聊天, the way WeChat means it: the conversation disappears from this
 * account's list, and its copy of the history goes with it.
 *
 * `deleteChatHistory` with `remove_from_chat_list: true, revoke: false` — the
 * peers keep their messages. `deleteChat` would be the other thing entirely
 * (delete for every member), which WeChat has no gesture for and this client must
 * never send by accident.
 */
export async function deleteChat(deps: ActionDeps, chatId: number): Promise<void> {
  await deps.invoke({
    _: 'deleteChatHistory',
    chat_id: chatId,
    remove_from_chat_list: true,
    revoke: false,
  })
  deps.emit({ type: 'chats', ops: [{ op: 'remove', chatId }] })
}

/**
 * 标为未读 / 标为已读. TDLib keeps this as a boolean flag next to `unread_count`
 * (a chat can be marked unread with nothing new), so the row draws a dot and the
 * refreshed summary carries the new state.
 */
export async function setChatUnread(
  deps: ActionDeps,
  chatId: number,
  unread: boolean,
): Promise<ChatSummary> {
  await deps.invoke({
    _: 'toggleChatIsMarkedAsUnread',
    chat_id: chatId,
    is_marked_as_unread: unread,
  })
  const summary = await fetchChatSummary(deps, chatId)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
  return summary
}

/**
 * The member grid of the 聊天信息 panel (design doc §9.9).
 *
 * TDLib answers `searchChatMembers` with ids only, so names come from the
 * mapper's cache and the photos are queued: the grid draws initials and gains
 * faces through `evt:avatars`, like the transcript's sender column. A private
 * chat has no grid — the panel draws the conversation's own face instead — and a
 * channel refuses the call without administrator rights, which is an empty grid,
 * not a broken panel.
 */
export async function listMembers(
  deps: ActionDeps,
  chatId: number,
  limit: number,
  query = '',
): Promise<ChatMember[]> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const type = chat?.type?._
  if (type === 'chatTypePrivate' || type === 'chatTypeSecret') return []
  let found: TdObject[] = []
  try {
    const response = await deps.invoke({
      _: 'searchChatMembers',
      chat_id: chatId,
      query,
      limit,
    })
    found = asArray<TdObject>(response?.members)
  } catch (error) {
    deps.logger.warn(
      `chat ${chatId} members are not available: ${error instanceof Error ? error.message : String(error)}`,
    )
    return []
  }
  const userIds = found
    .map((member) =>
      member.member_id?._ === 'messageSenderUser' ? Number(member.member_id.user_id) : 0,
    )
    .filter((userId) => userId > 0)
  deps.mapper.prefetchUserAvatars(userIds)
  return Promise.all(
    userIds.map(async (userId) => {
      const avatarUrl = deps.mapper.userAvatarUrls.get(userId)
      return {
        userId,
        title: await deps.mapper.resolveUserName(userId),
        ...(avatarUrl ? { avatarUrl } : {}),
      }
    }),
  )
}

/**
 * 群聊名称 (design doc §9.9). TDLib only allows this where the account may change
 * the chat's info; a refusal crosses IPC as an `AppError` and the dialog stays
 * open, so the reader can retry instead of losing what they typed.
 */
export async function setChatTitle(
  deps: ActionDeps,
  chatId: number,
  title: string,
): Promise<ChatSummary> {
  await deps.invoke({ _: 'setChatTitle', chat_id: chatId, title })
  const summary = await fetchChatSummary(deps, chatId)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
  return summary
}

/**
 * 退出群聊. The removal is announced explicitly: TDLib also reports it through
 * chat updates, but those can arrive after the panel has gone, and the row must
 * not linger in the list.
 */
export async function leaveChat(deps: ActionDeps, chatId: number): Promise<void> {
  await deps.invoke({ _: 'leaveChat', chat_id: chatId })
  deps.emit({ type: 'chats', ops: [{ op: 'remove', chatId }] })
}

/* 群公告 and 置顶 live in ./pins.ts. */

/**
 * 群二维码: a link a phone can open (design doc §9.9).
 *
 * With `temporary` (the QR window), the client's short-lived code is created: a
 * fresh link that expires after seven days, because WeChat refreshes the group QR
 * on every open. That needs administrator rights; when TDLib refuses, the window
 * still gets a usable link below and the validity line says it does not expire.
 *
 * Without it, a public group's username is used first because it costs nothing,
 * then the account's own newest link, and only then a new permanent one. A member
 * with no rights gets `null` and the window says so instead of failing.
 */
export interface InviteLinkDeps extends ActionDeps {
  /** Our own user id; `getChatInviteLinks` must name the link's creator. */
  getSelfUserId(): number | null
}

/** 群二维码's temporary code lifetime, in days (the client's own promise). */
const TEMPORARY_LINK_DAYS = 7

export async function inviteLink(
  deps: InviteLinkDeps,
  chatId: number,
  temporary = false,
): Promise<ChatInviteLink | null> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const type = chat?.type
  let publicLink: string | null = null
  if (type?._ === 'chatTypeSupergroup') {
    const supergroup = await deps.invoke({
      _: 'getSupergroup',
      supergroup_id: type.supergroup_id,
    })
    const username: string | undefined = supergroup?.usernames?.active_usernames?.[0]
    if (username) publicLink = `https://t.me/${username}`
  }

  if (temporary) {
    const expiresAt = Math.floor(Date.now() / 1000) + TEMPORARY_LINK_DAYS * 86_400
    try {
      const created = await deps.invoke({
        _: 'createChatInviteLink',
        chat_id: chatId,
        name: '',
        expiration_date: expiresAt,
        member_limit: 0,
      })
      if (created?.invite_link) return { link: String(created.invite_link), expiresAt }
    } catch (error) {
      deps.logger.warn(
        `chat ${chatId} cannot create a temporary invite link: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (publicLink) return { link: publicLink }

  const userId = deps.getSelfUserId()
  try {
    if (userId !== null) {
      const links = await deps.invoke({
        _: 'getChatInviteLinks',
        chat_id: chatId,
        creator_user_id: userId,
        is_revoked: false,
        offset_date: 0,
        offset_link: '',
        limit: 1,
      })
      const existing = asArray<TdObject>(links?.invite_links)[0]
      if (existing?.invite_link) return { link: String(existing.invite_link) }
    }
    const created = await deps.invoke({ _: 'createChatInviteLink', chat_id: chatId, name: '' })
    return created?.invite_link ? { link: String(created.invite_link) } : null
  } catch (error) {
    deps.logger.warn(
      `chat ${chatId} has no usable invite link: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}
