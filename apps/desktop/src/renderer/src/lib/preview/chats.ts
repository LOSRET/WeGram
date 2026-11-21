import type {
  ChatInviteLink,
  ChatMember,
  ChatPinnedMessage,
  ChatSummary,
  Contact,
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

/** 清空聊天记录: this account's copy only, exactly like the mock adapter. */
export function clearPreviewHistory(store: PreviewChatStore, chatId: number): void {
  const chat = findChat(store, chatId)
  store.messagesByChat[chat.id] = []
  chat.unread = 0
  delete chat.lastMessageText
  delete chat.lastMessageAt
  announce(store, chat)
}

/**
 * `@username` mentions: the fixture's address book is its only user directory,
 * so a known username answers with that person's private chat — the preview's
 * stand-in for TDLib's `searchPublicChat`.
 */
export function previewOpenUsername(
  chats: ChatSummary[],
  contacts: Contact[],
  input: string,
): ChatSummary {
  const username = input.trim().replace(/^@+/, '').toLowerCase()
  const contact = contacts.find((item) => item.username?.toLowerCase() === username)
  const chat = contact ? chats.find((item) => item.userId === contact.userId) : undefined
  if (!chat) throw { code: 'invalid_payload', message: `找不到 @${username} 这个用户名` }
  return { ...chat }
}

/** The fixture has no member table: the people who posted are the members. */
export function previewChatMembers(
  store: PreviewChatStore,
  chatId: number,
  limit: number,
  query = '',
): ChatMember[] {
  const chat = findChat(store, chatId)
  if (chat.kind === 'private') return []
  const needle = query.trim().toLowerCase()
  const seen = new Set<number>()
  const members: ChatMember[] = []
  for (const message of store.messagesByChat[chat.id] ?? []) {
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

/** The fixture pins nothing, so 群公告 reads 群主未设置. */
export function previewPinnedMessage(): ChatPinnedMessage | null {
  return null
}

/** 群二维码: a link that scans; the preview's is not a real group. */
export function previewInviteLink(chatId: number, temporary = false): ChatInviteLink | null {
  return {
    link: `https://t.me/wegram_preview_${Math.abs(chatId)}`,
    ...(temporary ? { expiresAt: Math.floor(Date.now() / 1000) + 7 * 86_400 } : {}),
  }
}

/** Global search, the mock adapter's title rule over the fixture account. */
export function searchPreviewChats(chats: ChatSummary[], q: string, limit: number): ChatSummary[] {
  const needle = q.trim().toLowerCase()
  if (needle === '') return []
  return chats.filter((chat) => chat.title.toLowerCase().includes(needle)).slice(0, limit)
}

/**
 * Cross-chat hits for the search panel, the mock adapter's rule over the fixture
 * account: one merged stream per scope, the numeric offset as its cursor.
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
  const needle = input.q.trim().toLowerCase()
  const wantChannel = input.scope === 'channel'
  const key = wantChannel ? 'channel' : 'private'
  const offset = Number.parseInt(input.cursor?.[key] ?? '0', 10) || 0

  const hits: { chat: ChatSummary; message: Message }[] = []
  for (const chat of store.chats) {
    if ((chat.kind === 'channel') !== wantChannel) continue
    for (const message of store.messagesByChat[chat.id] ?? []) {
      if (message.text.toLowerCase().includes(needle)) hits.push({ chat, message })
    }
  }
  hits.sort((a, b) => b.message.date - a.message.date || b.message.id - a.message.id)

  const page = hits.slice(offset, offset + input.limit)
  const next = offset + input.limit < hits.length ? String(offset + input.limit) : ''
  return {
    messages: page.map((hit) => hit.message),
    chats: [...new Map(page.map((hit) => [hit.chat.id, hit.chat])).values()].map((chat) => ({
      ...chat,
    })),
    total: hits.length,
    cursor: {
      private: wantChannel ? '' : next,
      group: '',
      channel: wantChannel ? next : '',
    },
  }
}

/** In-chat search, the mock adapter's substring rule over the transcript. */
export function searchPreviewMessages(
  store: PreviewChatStore,
  chatId: number,
  q: string,
): Message[] {
  const needle = q.toLowerCase()
  if (needle === '') return []
  return (store.messagesByChat[chatId] ?? []).filter((message) =>
    message.text.toLowerCase().includes(needle),
  )
}
