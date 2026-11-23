import { filterTopics, nextReadState, orderTopics, pageTopics } from '@wegram/mock-session'
import type { ChatSummary, ChatTopic, EventChannel, Message, TopicPage } from '@wegram/protocol'

/**
 * 话题 (design doc §9.12) in the browser preview: the same rules the mock adapter
 * runs (`@wegram/mock-session` for the order, the search and the paging), applied
 * to the preview's mutable session so both fakes answer identically.
 */
export interface PreviewTopicStore {
  chats: ChatSummary[]
  topicsByChat: Record<number, ChatTopic[]>
  messagesByChat: Record<number, Message[]>
  emit(channel: EventChannel, payload: unknown): void
}

function requireChat(store: PreviewTopicStore, chatId: number): ChatSummary {
  const chat = store.chats.find((item) => item.id === chatId)
  if (!chat) throw { code: 'invalid_payload', message: `找不到会话 ${chatId}` }
  return chat
}

function topicsOf(store: PreviewTopicStore, chatId: number): ChatTopic[] {
  return store.topicsByChat[chatId] ?? []
}

/** The chat row's unread is the sum of its topics', like TDLib's chat counter. */
function syncChatUnread(store: PreviewTopicStore, chatId: number): void {
  const chat = requireChat(store, chatId)
  const topics = topicsOf(store, chatId)
  if (topics.length === 0) return
  chat.unread = topics.reduce((total, topic) => total + topic.unread, 0)
}

function announce(store: PreviewTopicStore, chatId: number): void {
  store.emit('evt:topics', { chatId })
  const chat = store.chats.find((item) => item.id === chatId)
  if (chat) store.emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
}

export function previewTopicsList(
  store: PreviewTopicStore,
  input: {
    chatId: number
    query?: string
    cursor?: { topicId: number }
    limit?: number
  },
): TopicPage {
  const all = filterTopics(orderTopics(topicsOf(store, input.chatId)), input.query ?? '')
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const page = pageTopics(all, input.cursor?.topicId, limit)
  const last = page.topics.at(-1)
  return {
    topics: page.topics.map((topic) => ({ ...topic })),
    totalCount: all.length,
    next:
      page.nextTopicId !== null && last
        ? {
            date: last.lastMessageAt ?? 0,
            messageId: last.lastMessageId ?? 0,
            topicId: page.nextTopicId,
          }
        : null,
  }
}

export function previewTopicCreate(
  store: PreviewTopicStore,
  input: { chatId: number; title: string; iconColor: number; iconEmojiId?: string },
): ChatTopic {
  const topics = topicsOf(store, input.chatId)
  const id = Math.max(0, ...topics.map((topic) => topic.id)) + 1
  const topic: ChatTopic = {
    id,
    title: input.title,
    isGeneral: false,
    isClosed: false,
    isPinned: false,
    muted: false,
    iconColor: input.iconColor,
    ...(input.iconEmojiId && input.iconEmojiId !== '0' ? { iconEmojiId: input.iconEmojiId } : {}),
    unread: 0,
  }
  store.topicsByChat[input.chatId] = [...topics, topic]
  announce(store, input.chatId)
  return { ...topic }
}

export function previewTopicEdit(
  store: PreviewTopicStore,
  input: { chatId: number; topicId: number; title?: string; iconEmojiId?: string },
): void {
  store.topicsByChat[input.chatId] = topicsOf(store, input.chatId).map((topic) =>
    topic.id === input.topicId
      ? {
          ...topic,
          ...(input.title ? { title: input.title } : {}),
          ...(input.iconEmojiId === undefined
            ? {}
            : input.iconEmojiId === '0'
              ? { iconEmojiId: undefined }
              : { iconEmojiId: input.iconEmojiId }),
        }
      : topic,
  )
  announce(store, input.chatId)
}

export function previewTopicSetPinned(
  store: PreviewTopicStore,
  chatId: number,
  topicId: number,
  pinned: boolean,
): void {
  store.topicsByChat[chatId] = topicsOf(store, chatId).map((topic) =>
    topic.id === topicId ? { ...topic, isPinned: pinned } : topic,
  )
  announce(store, chatId)
}

export function previewTopicSetClosed(
  store: PreviewTopicStore,
  chatId: number,
  topicId: number,
  closed: boolean,
): void {
  store.topicsByChat[chatId] = topicsOf(store, chatId).map((topic) =>
    topic.id === topicId ? { ...topic, isClosed: closed } : topic,
  )
  announce(store, chatId)
}

export function previewTopicDelete(
  store: PreviewTopicStore,
  chatId: number,
  topicId: number,
): void {
  store.topicsByChat[chatId] = topicsOf(store, chatId).filter((topic) => topic.id !== topicId)
  store.messagesByChat[chatId] = (store.messagesByChat[chatId] ?? []).filter(
    (message) => message.topicId !== topicId,
  )
  syncChatUnread(store, chatId)
  announce(store, chatId)
}

export function previewTopicSetMuted(
  store: PreviewTopicStore,
  chatId: number,
  topicId: number,
  muted: boolean,
): void {
  store.topicsByChat[chatId] = topicsOf(store, chatId).map((topic) =>
    topic.id === topicId ? { ...topic, muted } : topic,
  )
  announce(store, chatId)
}

/** 话题图标: the fake account's three pieces of art (the sticker file ids). */
export function previewTopicIcons(): { id: string; emoji: string }[] {
  return [
    { id: '7001', emoji: '😀' },
    { id: '7002', emoji: '❤️' },
    { id: '7003', emoji: '✨' },
  ]
}

export function previewTopicLink(chatId: number, topicId: number): { link: string } | null {
  return { link: `https://t.me/c/${chatId}/${topicId}` }
}

/**
 * 标为已读 on one topic: the chat's own read rule (`nextReadState`) over this
 * topic's rows, then re-sum the chat — a report that stops short of the newest row
 * leaves the rest unread, exactly like a flat transcript.
 */
export function previewTopicMarkRead(
  store: PreviewTopicStore,
  chatId: number,
  topicId: number,
  upToMessageId: number,
): void {
  const topic = topicsOf(store, chatId).find((entry) => entry.id === topicId)
  if (!topic) return
  const state = nextReadState(
    topic,
    (store.messagesByChat[chatId] ?? []).filter((message) => message.topicId === topicId),
    upToMessageId,
  )
  if (!state) return
  store.topicsByChat[chatId] = topicsOf(store, chatId).map((entry) =>
    entry.id === topicId
      ? { ...entry, unread: state.unread, lastReadInboxMessageId: state.lastReadInboxMessageId }
      : entry,
  )
  syncChatUnread(store, chatId)
  announce(store, chatId)
}

/** 以聊天方式查看 / 以话题方式查看. */
export function previewSetViewAsTopics(
  store: PreviewTopicStore,
  chatId: number,
  viewAsTopics: boolean,
): ChatSummary {
  const chat = requireChat(store, chatId)
  chat.forum = viewAsTopics
  store.emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
  return { ...chat }
}
