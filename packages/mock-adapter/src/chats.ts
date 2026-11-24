import { sortChatList } from '@wegram/mock-session'
import { AppError } from '@wegram/protocol'
import type {
  ChatInviteLink,
  ChatJoinResult,
  ChatJoinState,
  ChatMember,
  ChatPinnedMessage,
  ChatSummary,
  PeerStatus,
} from '@wegram/protocol'

import type { AdapterEvent } from '@wegram/adapter-contract'
import type { Fixture } from './constants'

/**
 * The mock's conversation endpoints, kept beside the adapter so `index.ts` stays
 * inside its size budget: the chat list, opening a chat, the channel-permission
 * question and the 聊天信息 rows (mute, pin, clear, members).
 *
 * The rules are the fixture's. Pinning only flips the flag — the renderer sorts
 * pinned chats to the top through `sortChatList` when it applies the upsert —
 * clearing empties the transcript but keeps the row, and the member grid is the
 * people who posted, because the fixture has no member table.
 */
export interface MockChatStore {
  fixtures: Map<number, Fixture>
  emit(event: AdapterEvent): void
}

function requireFixture(store: MockChatStore, chatId: number): Fixture {
  const fixture = store.fixtures.get(chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${chatId}`)
  return fixture
}

export function listMockChats(
  store: MockChatStore,
  input: { limit: number; offset: number; list?: 'main' | 'archive' },
): ChatSummary[] {
  // Main and Archive are two lists, like TDLib's chatListMain / chatListArchive.
  const wantArchive = input.list === 'archive'
  const all = sortChatList(
    [...store.fixtures.values()]
      .map((fixture) => fixture.chat)
      .filter((chat) => (chat.archived === true) === wantArchive),
  )
  return all.slice(input.offset, input.offset + input.limit)
}

export function getMockChat(store: MockChatStore, chatId: number): ChatSummary {
  return requireFixture(store, chatId).chat
}

export function openMockChat(store: MockChatStore, chatId: number): void {
  // Opening does not consume the unread messages: the renderer reports
  // `messages:read` per viewport (see `tdlib/actions.openChat`). It does clear
  // 标为未读, which is a hand-set flag rather than a count.
  const fixture = requireFixture(store, chatId)
  if (!fixture.chat.markedUnread) return
  fixture.chat.markedUnread = false
  store.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
}

/**
 * `@username` mentions: the fixture's address-book entries are the only usernames
 * it has, exactly like TDLib's `searchPublicChat` answering from its local cache
 * for a known account.
 */
export function openMockUsernameChat(store: MockChatStore, input: string): ChatSummary {
  const username = input.trim().replace(/^@+/, '').toLowerCase()
  const fixture = [...store.fixtures.values()].find(
    (item) => item.contact?.username?.toLowerCase() === username,
  )
  if (!username || !fixture) throw new AppError('invalid_payload', `找不到 @${username} 这个用户名`)
  return fixture.chat
}

/** The mock has no user directory; reuse the private chat that carries that id. */
export function openMockPrivateChat(store: MockChatStore, userId: number): ChatSummary {
  const fixture =
    [...store.fixtures.values()].find((item) => item.chat.userId === userId) ??
    [...store.fixtures.values()].find((item) => item.chat.kind === 'private')
  if (!fixture) throw new AppError('not_implemented', `mock has no private chat for user ${userId}`)
  return fixture.chat
}

export function canMockPost(store: MockChatStore, chatId: number): boolean {
  const fixture = requireFixture(store, chatId)
  // Groups and private chats keep the composer; only channels gate on rights.
  return fixture.chat.kind === 'channel' ? Boolean(fixture.canPost) : true
}

/**
 * 频道底栏 (§9.9): the fixture channel marked `joined: false` is the previewed
 * one — the state a channel opened from 搜索 is in. Everything else is a member.
 */
export function mockChatJoinState(store: MockChatStore, chatId: number): ChatJoinState {
  const fixture = requireFixture(store, chatId)
  if (fixture.chat.kind !== 'channel') return { joined: true, byRequest: false }
  return { joined: fixture.joined !== false, byRequest: false }
}

/** 加入频道: the fixture subscribes at once; it never asks for approval. */
export function joinMockChannel(store: MockChatStore, chatId: number): ChatJoinResult {
  const fixture = requireFixture(store, chatId)
  if (fixture.chat.kind !== 'channel') throw new AppError('invalid_payload', '只有频道可以加入')
  fixture.joined = true
  return { joined: true, requestSent: false }
}

export function setMockMuted(store: MockChatStore, chatId: number, muted: boolean): ChatSummary {
  const fixture = requireFixture(store, chatId)
  fixture.chat.muted = muted
  store.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
  return { ...fixture.chat }
}

export function setMockPinned(store: MockChatStore, chatId: number, pinned: boolean): ChatSummary {
  const fixture = requireFixture(store, chatId)
  fixture.chat.pinned = pinned
  store.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
  return { ...fixture.chat }
}

/**
 * 归档 / 取消归档: the fixture keeps the flag and the renderer routes the upsert
 * into the archive list, exactly like TDLib's `addChatToList` move.
 */
export function setMockArchived(
  store: MockChatStore,
  chatId: number,
  archived: boolean,
): ChatSummary {
  const fixture = requireFixture(store, chatId)
  fixture.chat.archived = archived
  store.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
  return { ...fixture.chat }
}

/**
 * 清空聊天记录 for this account. The fixture keeps its chat row, minus the
 * preview — the same shape TDLib reports after `deleteChatHistory`.
 */
export function clearMockHistory(store: MockChatStore, chatId: number): void {
  const fixture = requireFixture(store, chatId)
  fixture.messages = []
  fixture.chat.unread = 0
  delete fixture.chat.lastMessageText
  delete fixture.chat.lastMessageAt
  store.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
}

/**
 * 在线 / 最后上线: the fixture has no presence schedule, so its private peers were
 * online an hour and a half ago — the "last seen" flavour the header formats.
 */
export function mockUserStatus(store: MockChatStore, userId: number): PeerStatus | null {
  const known = [...store.fixtures.values()].some((fixture) => fixture.chat.userId === userId)
  return known ? { kind: 'offline', wasOnline: Math.floor(Date.now() / 1000) - 5_400 } : null
}

/** 删除聊天: the fixture drops the conversation and its transcript. */
export function deleteMockChat(store: MockChatStore, chatId: number): void {
  requireFixture(store, chatId)
  store.fixtures.delete(chatId)
  store.emit({ type: 'chats', ops: [{ op: 'remove', chatId }] })
}

/** 标为未读 / 标为已读: the fixture's row draws a dot from this flag. */
export function setMockChatUnread(
  store: MockChatStore,
  chatId: number,
  unread: boolean,
): ChatSummary {
  const fixture = requireFixture(store, chatId)
  fixture.chat.markedUnread = unread
  store.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
  return { ...fixture.chat }
}

/**
 * The people who posted in the chat, which is the only member table the fixture
 * has. Private chats answer with nothing, like the real adapter (the panel then
 * draws the conversation's own face).
 */
export function mockChatMembers(
  store: MockChatStore,
  chatId: number,
  limit: number,
  query = '',
): ChatMember[] {
  const fixture = requireFixture(store, chatId)
  if (fixture.chat.kind === 'private') return []
  const needle = query.trim().toLowerCase()
  const seen = new Set<number>()
  const members: ChatMember[] = []
  for (const message of fixture.messages) {
    if (message.outgoing || message.senderId <= 0 || seen.has(message.senderId)) continue
    if (needle !== '' && !message.senderName.toLowerCase().includes(needle)) continue
    seen.add(message.senderId)
    members.push({
      userId: message.senderId,
      title: message.senderName,
      ...(message.senderAvatarUrl ? { avatarUrl: message.senderAvatarUrl } : {}),
    })
    if (members.length >= limit) break
  }
  return members
}

/**
 * 管理员显示群成员: a fixture channel marked `canPost` is the managed one, so it
 * is also the one whose member grid the panel draws (both are administrator
 * rights). Groups answer true, private chats have no member table.
 */
export function canMockGetMembers(store: MockChatStore, chatId: number): boolean {
  const fixture = requireFixture(store, chatId)
  if (fixture.chat.kind === 'channel') return Boolean(fixture.canPost)
  return fixture.chat.kind === 'group'
}

/**
 * 添加成员 (§8.3): a handle the fixture knows — a person's `contact.username` or
 * the bot's own — answered as who was added. The fixture has no member table
 * (the grid is the people who posted), so nothing changes on screen but the
 * toast; the real `addChatMembers` runs in the TDLib adapter.
 */
export function addMockChatMember(
  store: MockChatStore,
  chatId: number,
  username: string,
): { userId: number; title: string } {
  const fixture = requireFixture(store, chatId)
  if (fixture.chat.kind === 'private') {
    throw new AppError('invalid_payload', '私聊不能添加成员')
  }
  const handle = username.trim().replace(/^@+/, '').toLowerCase()
  for (const candidate of store.fixtures.values()) {
    const person = candidate.contact?.username?.toLowerCase() === handle
    const bot = candidate.bot?.username?.toLowerCase() === handle
    if (!(person || bot)) continue
    const userId = candidate.chat.userId ?? 0
    if (!userId) continue
    return { userId, title: candidate.chat.title }
  }
  throw new AppError('invalid_payload', `找不到 @${handle}`)
}

/** 群聊名称; the fixture has no permissions, so a rename always applies. */
export function setMockTitle(store: MockChatStore, chatId: number, title: string): ChatSummary {
  const fixture = requireFixture(store, chatId)
  fixture.chat.title = title
  store.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
  return { ...fixture.chat }
}

/** 退出群聊: the conversation leaves the list entirely. */
export function leaveMockChat(store: MockChatStore, chatId: number): void {
  requireFixture(store, chatId)
  store.fixtures.delete(chatId)
  store.emit({ type: 'chats', ops: [{ op: 'remove', chatId }] })
}

/** The fixture pins nothing, so 群公告 reads 群主未设置 like an untouched group. */
export function mockPinnedMessage(): ChatPinnedMessage | null {
  return null
}

/** 群二维码 needs a link a phone can open; the fixture's is not real but scans. */
export function mockInviteLink(chatId: number, temporary = false): ChatInviteLink | null {
  return {
    link: `https://t.me/wegram_mock_${Math.abs(chatId)}`,
    // A temporary code gets the client's 7-day promise, so the validity line and
    // the window's whole flow are exercised offline.
    ...(temporary ? { expiresAt: Math.floor(Date.now() / 1000) + 7 * 86_400 } : {}),
  }
}

/**
 * The adapter-facing shape (like `createMockComments`): the adapter assigns these
 * straight onto its methods, which keeps its class body inside the line budget.
 */
export interface MockChatApi {
  listChats(input: {
    limit: number
    offset: number
    list?: 'main' | 'archive'
  }): Promise<ChatSummary[]>
  prefetchAvatars(chatIds: number[]): Promise<void>
  getChat(chatId: number): Promise<ChatSummary>
  openChat(chatId: number): Promise<void>
  openPrivateChat(userId: number): Promise<ChatSummary>
  openUsernameChat(username: string): Promise<ChatSummary>
  canPost(chatId: number): Promise<boolean>
  canGetMembers(chatId: number): Promise<boolean>
  joinState(chatId: number): Promise<ChatJoinState>
  join(chatId: number): Promise<ChatJoinResult>
  setMuted(chatId: number, muted: boolean): Promise<ChatSummary>
  setPinned(chatId: number, pinned: boolean): Promise<ChatSummary>
  setArchived(chatId: number, archived: boolean): Promise<ChatSummary>
  clearHistory(chatId: number): Promise<void>
  deleteChat(chatId: number): Promise<void>
  setChatUnread(chatId: number, unread: boolean): Promise<ChatSummary>
  members(chatId: number, limit: number, query?: string): Promise<ChatMember[]>
  setTitle(chatId: number, title: string): Promise<ChatSummary>
  leave(chatId: number): Promise<void>
  pinnedMessage(chatId: number, topicId?: number): Promise<ChatPinnedMessage | null>
  setPinnedMessage(
    chatId: number,
    messageId: number | null,
    topicId?: number,
  ): Promise<ChatPinnedMessage | null>
  inviteLink(chatId: number, temporary?: boolean): Promise<ChatInviteLink | null>
  addMember(chatId: number, username: string): Promise<{ userId: number; title: string }>
  userStatus(userId: number): Promise<PeerStatus | null>
}

export function createMockChats(
  fixtures: Map<number, Fixture>,
  emit: (event: AdapterEvent) => void,
): MockChatApi {
  const store: MockChatStore = { fixtures, emit }
  /**
   * `chatId` or `chatId:topicId` → the one message that place has pinned (the
   * fixture pins nothing). A forum topic keeps its own pin, like TDLib.
   */
  const pins = new Map<string, ChatPinnedMessage>()
  const pinKey = (chatId: number, topicId: number | undefined): string =>
    topicId === undefined ? String(chatId) : `${chatId}:${topicId}`
  return {
    listChats: async (input) => listMockChats(store, input),
    /**
     * The fixtures' photos are registered when the account is built (see
     * ./avatars.ts), so every row already carries its URL and there is nothing
     * to queue; the channel is exercised all the same.
     */
    prefetchAvatars: async (_chatIds) => undefined,
    getChat: async (chatId) => getMockChat(store, chatId),
    openChat: async (chatId) => openMockChat(store, chatId),
    openPrivateChat: async (userId) => openMockPrivateChat(store, userId),
    openUsernameChat: async (username) => openMockUsernameChat(store, username),
    canPost: async (chatId) => canMockPost(store, chatId),
    canGetMembers: async (chatId) => canMockGetMembers(store, chatId),
    joinState: async (chatId) => mockChatJoinState(store, chatId),
    join: async (chatId) => joinMockChannel(store, chatId),
    setMuted: async (chatId, muted) => setMockMuted(store, chatId, muted),
    setPinned: async (chatId, pinned) => setMockPinned(store, chatId, pinned),
    setArchived: async (chatId, archived) => setMockArchived(store, chatId, archived),
    clearHistory: async (chatId) => clearMockHistory(store, chatId),
    deleteChat: async (chatId) => deleteMockChat(store, chatId),
    setChatUnread: async (chatId, unread) => setMockChatUnread(store, chatId, unread),
    members: async (chatId, limit, query) => mockChatMembers(store, chatId, limit, query),
    addMember: async (chatId, username) => addMockChatMember(store, chatId, username),
    setTitle: async (chatId, title) => setMockTitle(store, chatId, title),
    leave: async (chatId) => leaveMockChat(store, chatId),
    pinnedMessage: async (chatId, topicId) =>
      pins.get(pinKey(chatId, topicId)) ?? (topicId === undefined ? mockPinnedMessage() : null),
    setPinnedMessage: async (chatId, messageId, topicId) => {
      const fixture = requireFixture(store, chatId)
      if (messageId === null) {
        pins.delete(pinKey(chatId, topicId))
        return null
      }
      const message = fixture.messages.find((item) => item.id === messageId)
      if (!message) throw new AppError('internal', `Unknown mock message ${messageId}`)
      const pinned: ChatPinnedMessage = {
        messageId,
        text: message.text || `[${message.kind}]`,
      }
      pins.set(pinKey(chatId, topicId), pinned)
      return pinned
    },
    inviteLink: async (chatId, temporary) => mockInviteLink(chatId, temporary),
    userStatus: async (userId) => mockUserStatus(store, userId),
  }
}
