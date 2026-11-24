import {
  createTopic,
  DEFAULT_TOPIC_ICONS,
  removeTopic,
  setTopicFlag,
  sumTopicUnread,
  topicEditPatch,
  topicListPage,
  topicRead,
} from '@wegram/mock-session'
import type { ChatSummary, ChatTopic, EventChannel, Message, TopicPage } from '@wegram/protocol'

/**
 * 话题 (design doc §9.12) in the browser preview: the same rules the mock adapter
 * runs (`@wegram/mock-session`), applied to the preview's mutable session so both
 * fakes answer identically.
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
  chat.unread = sumTopicUnread(topics)
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
  return topicListPage(topicsOf(store, input.chatId), input)
}

export function previewTopicCreate(
  store: PreviewTopicStore,
  input: { chatId: number; title: string; iconColor: number; iconEmojiId?: string },
): ChatTopic {
  const topics = topicsOf(store, input.chatId)
  const topic = createTopic(topics, input)
  store.topicsByChat[input.chatId] = [...topics, topic]
  announce(store, input.chatId)
  return { ...topic }
}

export function previewTopicEdit(
  store: PreviewTopicStore,
  input: { chatId: number; topicId: number; title?: string; iconEmojiId?: string },
): void {
  const patch = topicEditPatch(input)
  store.topicsByChat[input.chatId] = topicsOf(store, input.chatId).map((topic) =>
    topic.id === input.topicId ? { ...topic, ...patch } : topic,
  )
  announce(store, input.chatId)
}

export function previewTopicSetPinned(
  store: PreviewTopicStore,
  chatId: number,
  topicId: number,
  pinned: boolean,
): void {
  store.topicsByChat[chatId] = setTopicFlag(topicsOf(store, chatId), topicId, 'isPinned', pinned)
  announce(store, chatId)
}

export function previewTopicSetClosed(
  store: PreviewTopicStore,
  chatId: number,
  topicId: number,
  closed: boolean,
): void {
  store.topicsByChat[chatId] = setTopicFlag(topicsOf(store, chatId), topicId, 'isClosed', closed)
  announce(store, chatId)
}

export function previewTopicDelete(
  store: PreviewTopicStore,
  chatId: number,
  topicId: number,
): void {
  store.topicsByChat[chatId] = removeTopic(topicsOf(store, chatId), topicId)
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
  store.topicsByChat[chatId] = setTopicFlag(topicsOf(store, chatId), topicId, 'muted', muted)
  announce(store, chatId)
}

/** 话题图标: the fake account's three-piece set (the sticker file ids). */
export function previewTopicIcons(): { id: string; emoji: string }[] {
  return DEFAULT_TOPIC_ICONS.map((icon) => ({ ...icon }))
}

export function previewTopicLink(chatId: number, topicId: number): { link: string } | null {
  return { link: `https://t.me/c/${chatId}/${topicId}` }
}

/**
 * 标为已读 on one topic: the fakes' shared read rule over this topic's rows, then
 * the chat is re-summed — a report that stops short of the newest row leaves the
 * rest unread, exactly like a flat transcript.
 */
export function previewTopicMarkRead(
  store: PreviewTopicStore,
  chatId: number,
  topicId: number,
  upToMessageId: number,
): void {
  const read = topicRead(
    topicsOf(store, chatId),
    topicId,
    (store.messagesByChat[chatId] ?? []).filter((message) => message.topicId === topicId),
    upToMessageId,
  )
  if (!read) return
  store.topicsByChat[chatId] = read.topics
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
