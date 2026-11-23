import { filterTopics, orderTopics, pageTopics } from '@wegram/mock-session'
import { AppError } from '@wegram/protocol'
import type { ChatSummary, ChatTopic, TopicIcon, TopicPage } from '@wegram/protocol'

import type { AdapterEvent } from '@wegram/adapter-contract'
import type { Fixture } from './constants'

/**
 * 话题 (design doc §9.12) for the fake account: the list, its cursor and the
 * management calls, held in the fixture itself so both fakes and the UI see one
 * state. Real TDLib hands ordering to the server (`forumTopic.order`); the mock
 * sorts the way the official client shows it — pinned, General, then newest
 * activity.
 */
export interface MockTopicStore {
  fixtures: Map<number, Fixture>
  emit(event: AdapterEvent): void
}

function requireFixture(store: MockTopicStore, chatId: number): Fixture {
  const fixture = store.fixtures.get(chatId)
  if (!fixture) throw new AppError('internal', `Unknown mock chat ${chatId}`)
  return fixture
}

function topicsOf(fixture: Fixture): ChatTopic[] {
  return fixture.topics ?? []
}


/** The chat row's unread is the sum of its topics', like TDLib's chat counter. */
function syncChatUnread(fixture: Fixture): void {
  const topics = topicsOf(fixture)
  if (topics.length === 0) return
  fixture.chat = {
    ...fixture.chat,
    unread: topics.reduce((total, topic) => total + topic.unread, 0),
  }
}

function announce(store: MockTopicStore, chatId: number): void {
  store.emit({ type: 'topics', chatId })
  const fixture = store.fixtures.get(chatId)
  if (fixture) store.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
}

export function createMockTopics(store: MockTopicStore) {
  const list = async (input: {
    chatId: number
    query?: string
    cursor?: { date: number; messageId: number; topicId: number }
    limit?: number
  }): Promise<TopicPage> => {
    const fixture = requireFixture(store, input.chatId)
    // The shared fake rules own the order and the search (`@wegram/mock-session`).
    const all = filterTopics(orderTopics(topicsOf(fixture)), input.query ?? '')
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

  const create = async (input: {
    chatId: number
    title: string
    iconColor: number
    iconEmojiId?: string
  }): Promise<ChatTopic> => {
    const fixture = requireFixture(store, input.chatId)
    const topics = topicsOf(fixture)
    // 1 is General and never allocated; real ids are message ids, so this is
    // unique without asking anything.
    const id = Math.max(0, ...topics.map((topic) => topic.id)) + 1
    const topic: ChatTopic = {
      id,
      title: input.title,
      isGeneral: false,
      isClosed: false,
      isPinned: false,
      muted: false,
      iconColor: input.iconColor,
      ...(input.iconEmojiId && input.iconEmojiId !== '0'
        ? { iconEmojiId: input.iconEmojiId }
        : {}),
      unread: 0,
    }
    fixture.topics = [...topics, topic]
    announce(store, input.chatId)
    return { ...topic }
  }

  const edit = async (input: {
    chatId: number
    topicId: number
    title?: string
    iconEmojiId?: string
  }): Promise<void> => {
    const fixture = requireFixture(store, input.chatId)
    fixture.topics = topicsOf(fixture).map((topic) =>
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

  const setPinned = async (chatId: number, topicId: number, pinned: boolean): Promise<void> => {
    const fixture = requireFixture(store, chatId)
    fixture.topics = topicsOf(fixture).map((topic) =>
      topic.id === topicId ? { ...topic, isPinned: pinned } : topic,
    )
    announce(store, chatId)
  }

  const setClosed = async (chatId: number, topicId: number, closed: boolean): Promise<void> => {
    const fixture = requireFixture(store, chatId)
    fixture.topics = topicsOf(fixture).map((topic) =>
      topic.id === topicId ? { ...topic, isClosed: closed } : topic,
    )
    announce(store, chatId)
  }

  const remove = async (chatId: number, topicId: number): Promise<void> => {
    const fixture = requireFixture(store, chatId)
    fixture.topics = topicsOf(fixture).filter((topic) => topic.id !== topicId)
    fixture.messages = fixture.messages.filter((message) => message.topicId !== topicId)
    const last = fixture.messages.at(-1)
    fixture.chat = {
      ...fixture.chat,
      ...(last
        ? { lastMessageText: last.text, lastMessageAt: last.date }
        : { lastMessageText: undefined, lastMessageAt: undefined }),
    }
    syncChatUnread(fixture)
    announce(store, chatId)
  }

  /** 话题免打扰: the row's own flag, refreshed through `evt:topics`. */
  const setMuted = async (chatId: number, topicId: number, muted: boolean): Promise<void> => {
    const fixture = requireFixture(store, chatId)
    fixture.topics = topicsOf(fixture).map((topic) =>
      topic.id === topicId ? { ...topic, muted } : topic,
    )
    announce(store, chatId)
  }

  /**
   * 话题图标: the fake account's three piece-of-art emoji. The ids are the sticker
   * file ids, which is how the mock's custom-emoji lookup is keyed.
   */
  const icons = async (): Promise<TopicIcon[]> => [
    { id: '7001', emoji: '😀' },
    { id: '7002', emoji: '❤️' },
    { id: '7003', emoji: '✨' },
  ]

  /** 复制话题链接: a t.me link the fake account can open again. */
  const link = async (chatId: number, topicId: number): Promise<{ link: string } | null> => {
    const fixture = requireFixture(store, chatId)
    const topic = topicsOf(fixture).find((entry) => entry.id === topicId)
    return topic ? { link: `https://t.me/c/${chatId}/${topic.id}` } : null
  }

  /** 标为已读 (the topic menu's item): clears one topic, re-sums the chat. */
  const markRead = async (chatId: number, topicId: number, upToMessageId: number): Promise<void> => {
    const fixture = requireFixture(store, chatId)
    fixture.topics = topicsOf(fixture).map((topic) =>
      topic.id === topicId
        ? { ...topic, unread: 0, lastReadInboxMessageId: upToMessageId }
        : topic,
    )
    syncChatUnread(fixture)
    announce(store, chatId)
  }

  /** 以聊天方式查看 / 以话题方式查看. */
  const setViewAsTopics = async (chatId: number, viewAsTopics: boolean): Promise<ChatSummary> => {
    const fixture = requireFixture(store, chatId)
    fixture.chat = { ...fixture.chat, forum: viewAsTopics }
    store.emit({ type: 'chats', ops: [{ op: 'upsert', chat: { ...fixture.chat } }] })
    return { ...fixture.chat }
  }

  return {
    list,
    create,
    edit,
    setPinned,
    setClosed,
    setMuted,
    icons,
    remove,
    link,
    markRead,
    setViewAsTopics,
  }
}