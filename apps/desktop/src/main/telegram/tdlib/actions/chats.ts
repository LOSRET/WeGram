import { AppError } from '@wegram/protocol'
import type { ChatSummary } from '@wegram/protocol'

import { asArray } from '../json'
import { mapChat } from '../map/chat'
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
  input: { limit: number; offset: number },
): Promise<ChatSummary[]> {
  // TDLib has no offset for getChats: fetch enough ids and slice (§6.3).
  const response = await deps.invoke({
    _: 'getChats',
    chat_list: { _: 'chatListMain' },
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
  await deps.invoke({ _: 'getChat', chat_id: chatId })
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
