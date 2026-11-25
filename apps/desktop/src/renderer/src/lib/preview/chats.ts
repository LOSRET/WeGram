import {
  applyChatCleared,
  canFakeGetMembers,
  canFakePost,
  chatPinKey,
  fakeJoinState,
  listedChatMembers,
  pinnedMessageFrom,
  searchChatRows,
  searchMessageRows,
  searchMessagesInScope,
} from '@wegram/mock-session'
import type { MessageSearchFilter } from '@wegram/mock-session'
import type {
  ChatInviteLink,
  ChatJoinResult,
  ChatJoinState,
  ChatMember,
  ChatPinnedMessage,
  ChatSummary,
  EventChannel,
  Message,
  SearchMessagesCursor,
} from '@wegram/protocol'

/**
 * The chat-side handlers of the browser preview (design doc §9.9), split out of
 * `preview/index.ts` to keep that file inside its size budget.
 *
 * They mirror the mock adapter's rules one for one — the preview exists so the UI
 * can be clicked through without Electron, so the two must not drift. The session
 * (chat rows, transcripts, event emitter) is handed in by `index.ts`.
 */
export interface PreviewChatStore {
  chats: ChatSummary[]
  messagesByChat: Record<number, Message[]>
  emit(channel: EventChannel, payload: unknown): void
}

function findChat(store: PreviewChatStore, chatId: number): ChatSummary {
  const chat = store.chats.find((item) => item.id === chatId)
  if (!chat) throw { code: 'internal', message: 'unknown preview chat' }
  return chat
}

function announce(store: PreviewChatStore, chat: ChatSummary): void {
  store.emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
}

/**
 * 频道底栏 (§9.9): the fixture's unjoined channels are the previewed ones, which
 * is exactly the state a channel opened from 搜索 is in.
 */
export function previewJoinState(chat: ChatSummary, notJoined: Set<number>): ChatJoinState {
  return fakeJoinState(chat, !notJoined.has(chat.id))
}

/** 发帖权限: only a channel gates on rights, exactly like the mock adapter. */
export function previewCanPost(
  chat: ChatSummary,
  channelPostRights: Record<number, boolean>,
): boolean {
  return canFakePost(chat, channelPostRights[chat.id])
}

/** 管理员显示群成员: a managed fixture channel is the administrator case. */
export function previewCanGetMembers(
  chat: ChatSummary,
  channelPostRights: Record<number, boolean>,
): boolean {
  return canFakeGetMembers(chat, channelPostRights[chat.id])
}

/** 加入频道: the preview subscribes at once; it never asks for approval. */
export function joinPreviewChannel(notJoined: Set<number>, chatId: number): ChatJoinResult {
  notJoined.delete(chatId)
  return { joined: true, requestSent: false }
}

export function setPreviewMuted(
  store: PreviewChatStore,
  chatId: number,
  muted: boolean,
): ChatSummary {
  const chat = findChat(store, chatId)
  chat.muted = muted
  announce(store, chat)
  return { ...chat }
}

export function setPreviewPinned(
  store: PreviewChatStore,
  chatId: number,
  pinned: boolean,
): ChatSummary {
  const chat = findChat(store, chatId)
  chat.pinned = pinned
  announce(store, chat)
  return { ...chat }
}

/** 归档 / 取消归档: the preview keeps the flag; the shell routes the upsert. */
export function setPreviewArchived(
  store: PreviewChatStore,
  chatId: number,
  archived: boolean,
): ChatSummary {
  const chat = findChat(store, chatId)
  chat.archived = archived
  announce(store, chat)
  return { ...chat }
}

/** 清空聊天记录: this account's copy only, exactly like the mock adapter. */
export function clearPreviewHistory(store: PreviewChatStore, chatId: number): void {
  const chat = findChat(store, chatId)
  store.messagesByChat[chat.id] = []
  applyChatCleared(chat)
  announce(store, chat)
}

/** 删除聊天: the preview drops the row and the transcript, like the mock adapter. */
export function deletePreviewChat(store: PreviewChatStore, chatId: number): void {
  const chat = findChat(store, chatId)
  store.chats.splice(store.chats.indexOf(chat), 1)
  delete store.messagesByChat[chat.id]
  store.emit('evt:chats', { ops: [{ op: 'remove', chatId }] })
}

/** 标为未读 / 标为已读: the preview's row draws its dot from this flag. */
export function setPreviewUnread(
  store: PreviewChatStore,
  chatId: number,
  unread: boolean,
): ChatSummary {
  const chat = findChat(store, chatId)
  chat.markedUnread = unread
  announce(store, chat)
  return { ...chat }
}

/**
 * `@username` mentions: the fixture's address book is its only user directory,
 * so a known username answers with that person's private chat — the preview's
 * stand-in for TDLib's `searchPublicChat`.
 */
export function previewOpenUsername(
  chats: ChatSummary[],
  input: string,
  resolve: (username: string) => { userId: number } | null,
): ChatSummary {
  const username = input.trim().replace(/^@+/, '').toLowerCase()
  const member = resolve(input)
  const chat = member ? chats.find((item) => item.userId === member.userId) : undefined
  if (!chat) throw { code: 'invalid_payload', message: `找不到 @${username} 这个用户名` }
  return { ...chat }
}

/**
 * 添加成员 (§8.3): the handle is resolved by the caller (the fixtures know who
 * owns one) and a group answers who was added. The fixture has no member table,
 * so nothing changes on screen — same as the mock adapter.
 */
export function previewAddMember(
  store: PreviewChatStore,
  input: { chatId: number; username: string },
  resolve: (username: string) => { userId: number; title: string } | null,
): { userId: number; title: string } {
  const chat = findChat(store, Number(input.chatId))
  if (chat.kind === 'private') throw { code: 'invalid_payload', message: '私聊不能添加成员' }
  const member = resolve(String(input.username ?? ''))
  if (!member) {
    const handle = String(input.username ?? '')
      .trim()
      .replace(/^@+/, '')
    throw { code: 'invalid_payload', message: `找不到 @${handle}` }
  }
  return member
}

/** The fixture has no member table: the people who posted are the members. */
export function previewChatMembers(
  store: PreviewChatStore,
  chatId: number,
  limit: number,
  query = '',
): ChatMember[] {
  const chat = findChat(store, chatId)
  return listedChatMembers(store.messagesByChat[chat.id] ?? [], {
    limit,
    query,
    isPrivate: chat.kind === 'private',
  })
}

/** 群聊名称: the preview has no permissions, so a rename always applies. */
export function setPreviewTitle(
  store: PreviewChatStore,
  chatId: number,
  title: string,
): ChatSummary {
  const chat = findChat(store, chatId)
  chat.title = title
  announce(store, chat)
  return { ...chat }
}

/** 退出群聊: the row leaves the list, exactly like `leaveChat` on the mock. */
export function leavePreviewChat(store: PreviewChatStore, chatId: number): void {
  const chat = findChat(store, chatId)
  store.chats.splice(store.chats.indexOf(chat), 1)
  delete store.messagesByChat[chat.id]
  store.emit('evt:chats', { ops: [{ op: 'remove', chatId }] })
}

/** The fixture pins nothing until this session pins one (see previewPinMessage). */
export function previewPinnedMessage(
  pins: Map<string, ChatPinnedMessage>,
  chatId: number,
  topicId?: number,
): ChatPinnedMessage | null {
  return pins.get(chatPinKey(chatId, topicId)) ?? null
}

/** 置顶消息 / 取消置顶: `null` removes the chat's pin, like the real channel. */
export function previewPinMessage(
  store: PreviewChatStore,
  pins: Map<string, ChatPinnedMessage>,
  chatId: number,
  messageId: number | null,
  topicId?: number,
): ChatPinnedMessage | null {
  if (messageId === null) {
    pins.delete(chatPinKey(chatId, topicId))
    return null
  }
  const message = (store.messagesByChat[chatId] ?? []).find((item) => item.id === messageId)
  const pinned: ChatPinnedMessage = pinnedMessageFrom(message, messageId)
  pins.set(chatPinKey(chatId, topicId), pinned)
  return pinned
}

/** 群二维码: a link that scans; the preview's is not a real group. */
export function previewInviteLink(chatId: number, temporary = false): ChatInviteLink | null {
  return {
    link: `https://t.me/wegram_preview_${Math.abs(chatId)}`,
    ...(temporary ? { expiresAt: Math.floor(Date.now() / 1000) + 7 * 86_400 } : {}),
  }
}

/** Global search: the fakes' shared title rule over the fixture account. */
export function searchPreviewChats(chats: ChatSummary[], q: string, limit: number): ChatSummary[] {
  return searchChatRows(chats, q, limit)
}

/**
 * Cross-chat hits for the search panel: the fakes' shared scope rule over the
 * fixture account, one merged stream per scope with the numeric offset as its
 * cursor.
 */
export function searchPreviewAllMessages(
  store: PreviewChatStore,
  input: {
    q: string
    scope: 'chat' | 'channel'
    limit: number
    cursor?: SearchMessagesCursor
  },
): {
  messages: Message[]
  chats: ChatSummary[]
  total: number
  cursor: SearchMessagesCursor
} {
  return searchMessagesInScope(
    store.chats.map((chat) => ({ chat, messages: store.messagesByChat[chat.id] ?? [] })),
    input,
  )
}

/** The 聊天文件 tab a payload names, narrowed where it enters the preview. */
export function previewSearchFilter(value: unknown): MessageSearchFilter | undefined {
  switch (value) {
    case 'photo':
    case 'video':
    case 'file':
    case 'url':
      return value
    default:
      return undefined
  }
}

/** In-chat search: the fakes' shared substring / 聊天文件 filter rule. */
export function searchPreviewMessages(
  store: PreviewChatStore,
  chatId: number,
  q: string,
  filter?: MessageSearchFilter,
): Message[] {
  return searchMessageRows(store.messagesByChat[chatId] ?? [], q, filter)
}

/**
 * The pins of this preview session: `chats:pinned` and `chats:setPinnedMessage`
 * share one map, so the bar and the menu see the same answer the mock adapter's.
 */
export function handlePreviewPins(
  channel: 'chats:pinned' | 'chats:setPinnedMessage',
  store: PreviewChatStore,
  pins: Map<string, ChatPinnedMessage>,
  payload: Record<string, unknown>,
): ChatPinnedMessage | null {
  const chatId = Number(payload['chatId'])
  const topicId = payload['topicId'] === undefined ? undefined : Number(payload['topicId'])
  if (channel === 'chats:pinned') return previewPinnedMessage(pins, chatId, topicId)
  const messageId = payload['messageId']
  return previewPinMessage(
    store,
    pins,
    chatId,
    messageId === null || messageId === undefined ? null : Number(messageId),
    topicId,
  )
}
