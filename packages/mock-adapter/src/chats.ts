import { sortChatList } from '@wegram/mock-session'
import { AppError } from '@wegram/protocol'
import type { ChatInviteLink, ChatMember, ChatPinnedMessage, ChatSummary } from '@wegram/protocol'

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
  input: { limit: number; offset: number },
): ChatSummary[] {
  const all = sortChatList([...store.fixtures.values()].map((fixture) => fixture.chat))
  return all.slice(input.offset, input.offset + input.limit)
}

export function getMockChat(store: MockChatStore, chatId: number): ChatSummary {
  return requireFixture(store, chatId).chat
}

export function openMockChat(store: MockChatStore, chatId: number): void {
  // Opening does not consume the unread messages: the renderer reports
  // `messages:read` per viewport (see `tdlib/actions.openChat`).
  requireFixture(store, chatId)
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
  listChats(input: { limit: number; offset: number }): Promise<ChatSummary[]>
  getChat(chatId: number): Promise<ChatSummary>
  openChat(chatId: number): Promise<void>
  openPrivateChat(userId: number): Promise<ChatSummary>
  canPost(chatId: number): Promise<boolean>
  setMuted(chatId: number, muted: boolean): Promise<ChatSummary>
  setPinned(chatId: number, pinned: boolean): Promise<ChatSummary>
  clearHistory(chatId: number): Promise<void>
  members(chatId: number, limit: number, query?: string): Promise<ChatMember[]>
  setTitle(chatId: number, title: string): Promise<ChatSummary>
  leave(chatId: number): Promise<void>
  pinnedMessage(): Promise<ChatPinnedMessage | null>
  inviteLink(chatId: number, temporary?: boolean): Promise<ChatInviteLink | null>
}

export function createMockChats(
  fixtures: Map<number, Fixture>,
  emit: (event: AdapterEvent) => void,
): MockChatApi {
  const store: MockChatStore = { fixtures, emit }
  return {
    listChats: async (input) => listMockChats(store, input),
    getChat: async (chatId) => getMockChat(store, chatId),
    openChat: async (chatId) => openMockChat(store, chatId),
    openPrivateChat: async (userId) => openMockPrivateChat(store, userId),
    canPost: async (chatId) => canMockPost(store, chatId),
    setMuted: async (chatId, muted) => setMockMuted(store, chatId, muted),
    setPinned: async (chatId, pinned) => setMockPinned(store, chatId, pinned),
    clearHistory: async (chatId) => clearMockHistory(store, chatId),
    members: async (chatId, limit, query) => mockChatMembers(store, chatId, limit, query),
    setTitle: async (chatId, title) => setMockTitle(store, chatId, title),
    leave: async (chatId) => leaveMockChat(store, chatId),
    pinnedMessage: async () => mockPinnedMessage(),
    inviteLink: async (chatId, temporary) => mockInviteLink(chatId, temporary),
  }
}
