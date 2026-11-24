/**
 * The conversation rules both fakes answer (design doc §9.2 / §9.9): the member
 * grid, 管理员显示群成员, 频道底栏's join state, 清空聊天记录 and the pinned-message
 * row. They are structural on purpose — this package imports nothing — and the
 * stores stay with each fake (a fixture map in the mock, arrays in the preview).
 */

/** The transcript fields the member grid reads (a protocol `Message` has them). */
export interface FakeMemberMessage {
  outgoing: boolean
  senderId: number
  senderName: string
  senderAvatarUrl?: string
}

export interface FakeChatMember {
  userId: number
  title: string
  avatarUrl?: string
}

/**
 * The people who posted in the chat — the only member table a fixture has.
 * Private chats answer with nothing (the panel draws the conversation's own
 * face), and `query` is 搜索群成员: a substring over the display name.
 */
export function listedChatMembers<M extends FakeMemberMessage>(
  messages: readonly M[],
  input: { limit: number; query?: string; isPrivate: boolean },
): FakeChatMember[] {
  if (input.isPrivate) return []
  const needle = (input.query ?? '').trim().toLowerCase()
  const seen = new Set<number>()
  const members: FakeChatMember[] = []
  for (const message of messages) {
    if (message.outgoing || message.senderId <= 0 || seen.has(message.senderId)) continue
    if (needle !== '' && !message.senderName.toLowerCase().includes(needle)) continue
    seen.add(message.senderId)
    members.push({
      userId: message.senderId,
      title: message.senderName,
      ...(message.senderAvatarUrl ? { avatarUrl: message.senderAvatarUrl } : {}),
    })
    if (members.length >= input.limit) break
  }
  return members
}

/** The composer question: groups and private chats keep it, a channel needs the right. */
export function canFakePost(chat: { kind: string }, canPost: boolean | undefined): boolean {
  return chat.kind === 'channel' ? Boolean(canPost) : true
}

/**
 * 管理员显示群成员: a channel exposes its subscribers only to administrators, and
 * the fixture marks that with the same `canPost` right. Groups say yes, private
 * chats have no member table.
 */
export function canFakeGetMembers(chat: { kind: string }, canPost: boolean | undefined): boolean {
  if (chat.kind === 'channel') return Boolean(canPost)
  return chat.kind === 'group'
}

/**
 * 频道底栏: whether this account belongs to the channel. Only a previewed channel
 * (the fixture's `joined: false`) is not a member; joining never asks approval.
 */
export function fakeJoinState(
  chat: { kind: string },
  joined: boolean | undefined,
): { joined: boolean; byRequest: boolean } {
  if (chat.kind !== 'channel') return { joined: true, byRequest: false }
  return { joined: joined !== false, byRequest: false }
}

/**
 * 清空聊天记录 for this account: the row stays, without its preview and counter —
 * the shape TDLib reports after `deleteChatHistory` (`revoke: false`).
 */
export function applyChatCleared(chat: {
  unread: number
  lastMessageText?: string
  lastMessageAt?: number
}): void {
  chat.unread = 0
  delete chat.lastMessageText
  delete chat.lastMessageAt
}

/** The key a chat's pin is stored under; a forum topic keeps its own pin. */
export function chatPinKey(chatId: number, topicId: number | undefined): string {
  return topicId === undefined ? String(chatId) : `${chatId}:${topicId}`
}

/**
 * 群公告 / 置顶消息: the row the client draws. A message with no text is labelled by
 * its kind, like TDLib's own preview of a media row.
 */
export function pinnedMessageFrom(
  message: { text: string; kind: string } | undefined,
  messageId: number,
): { messageId: number; text: string } {
  return { messageId, text: message?.text || `[${message?.kind ?? '消息'}]` }
}
