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
import { AppError } from '@wegram/protocol'
import type { ChatSummary, ChatTopic, TopicIcon, TopicPage } from '@wegram/protocol'

import type { AdapterEvent } from '@wegram/adapter-contract'
import type { Fixture } from './constants'

/**
 * 话题 (design doc §9.12) for the fake account: the list, its cursor and the
 * management calls, held in the fixture itself so both fakes and the UI see one
 * state. The rules are `@wegram/mock-session`'s — the browser preview runs the
 * same ones, so the two fakes cannot disagree about a topic row. Real TDLib hands
 * ordering to the server (`forumTopic.order`).
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
  fixture.chat = { ...fixture.chat, unread: sumTopicUnread(topics) }
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
    return topicListPage(topicsOf(fixture), input)
  }

  const create = async (input: {
    chatId: number
    title: string
    iconColor: number
    iconEmojiId?: string
  }): Promise<ChatTopic> => {
    const fixture = requireFixture(store, input.chatId)
    const topic = createTopic(topicsOf(fixture), input)
    fixture.topics = [...topicsOf(fixture), topic]
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
    const patch = topicEditPatch(input)
    fixture.topics = topicsOf(fixture).map((topic) =>
      topic.id === input.topicId ? { ...topic, ...patch } : topic,
    )
    announce(store, input.chatId)
  }

  const setPinned = async (chatId: number, topicId: number, pinned: boolean): Promise<void> => {
    const fixture = requireFixture(store, chatId)
    fixture.topics = setTopicFlag(topicsOf(fixture), topicId, 'isPinned', pinned)
    announce(store, chatId)
  }

  const setClosed = async (chatId: number, topicId: number, closed: boolean): Promise<void> => {
    const fixture = requireFixture(store, chatId)
    fixture.topics = setTopicFlag(topicsOf(fixture), topicId, 'isClosed', closed)
    announce(store, chatId)
  }

  const remove = async (chatId: number, topicId: number): Promise<void> => {
    const fixture = requireFixture(store, chatId)
    fixture.topics = removeTopic(topicsOf(fixture), topicId)
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
    fixture.topics = setTopicFlag(topicsOf(fixture), topicId, 'muted', muted)
    announce(store, chatId)
  }

  /** 话题图标: the fake account's three-piece set, as the picker draws it. */
  const icons = async (): Promise<TopicIcon[]> =>
    DEFAULT_TOPIC_ICONS.map((icon) => ({ ...icon }))

  /** 复制话题链接: a t.me link the fake account can open again. */
  const link = async (chatId: number, topicId: number): Promise<{ link: string } | null> => {
    const fixture = requireFixture(store, chatId)
    const topic = topicsOf(fixture).find((entry) => entry.id === topicId)
    return topic ? { link: `https://t.me/c/${chatId}/${topic.id}` } : null
  }

  /**
   * 标为已读 (the topic menu's item): one topic's marker and counter, re-summed
   * into the chat. The read rule itself is `topicRead`'s.
   */
  const markRead = async (
    chatId: number,
    topicId: number,
    upToMessageId: number,
  ): Promise<void> => {
    const fixture = requireFixture(store, chatId)
    const read = topicRead(
      topicsOf(fixture),
      topicId,
      fixture.messages.filter((message) => message.topicId === topicId),
      upToMessageId,
    )
    if (!read) return
    fixture.topics = read.topics
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
