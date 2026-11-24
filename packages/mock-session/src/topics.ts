import { nextReadState, type ReadState } from './read'

/**
 * The rules of a fake forum's topic list (design doc §9.12): the order, the paging
 * and the four writes the topic sheets perform.
 *
 * Shared by the two fakes: TDLib sorts topics by its own `order` string and pages
 * them by a three-part cursor, so the fakes only have to agree on what the official
 * client shows — pinned first, then General, then the newest activity — and on what
 * a page's cursor means. The same goes for building a topic and for the flags the
 * list's menu sets, which both fakes used to spell out twice. Dependency-free on
 * purpose: `@wegram/mock-session` is bundled into the renderer.
 */

export interface TopicLike {
  id: number
  title: string
  isPinned: boolean
  isGeneral: boolean
  lastMessageAt?: number
}

/** 置顶 → 综合 → 最新活动, the order the official client draws. */
export function orderTopics<T extends TopicLike>(topics: readonly T[]): T[] {
  return [...topics].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    if (a.isGeneral !== b.isGeneral) return a.isGeneral ? -1 : 1
    return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  })
}

/** 搜索话题: a case-insensitive substring match, like TDLib's name search. */
export function filterTopics<T extends TopicLike>(topics: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...topics]
  return topics.filter((topic) => topic.title.toLowerCase().includes(needle))
}

export interface TopicPage<T> {
  topics: T[]
  /** The last row's id, to continue from; `null` when the page is the last one. */
  nextTopicId: number | null
}

/** A page after `cursorId` (undefined for the first one). */
export function pageTopics<T extends TopicLike>(
  topics: readonly T[],
  cursorId: number | undefined,
  limit: number,
): TopicPage<T> {
  const start =
    cursorId === undefined
      ? 0
      : Math.max(0, topics.findIndex((topic) => topic.id === cursorId) + 1)
  const page = [...topics.slice(start, start + limit)]
  const last = page.at(-1)
  const hasMore = start + page.length < topics.length
  return { topics: page, nextTopicId: hasMore && last ? last.id : null }
}

/** The fields every fake topic row carries; `ChatTopic` satisfies this. */
export interface TopicRecord extends TopicLike {
  isClosed: boolean
  muted: boolean
  iconColor: number
  iconEmojiId?: string
  unread: number
  lastMessageId?: number
  lastReadInboxMessageId?: number
}

/** The three flags a topic row can be switched into. */
export interface TopicFlags {
  isPinned: boolean
  isClosed: boolean
  muted: boolean
}

export type TopicFlag = keyof TopicFlags

/** 新建话题 as both fakes answer it. */
export interface NewTopicInput {
  title: string
  iconColor: number
  iconEmojiId?: string
}

/**
 * The id a new topic gets: 1 is General and never allocated. Real ids are message
 * ids, so one past the maximum is unique without asking anything.
 */
export function nextTopicId(topics: readonly { id: number }[]): number {
  return Math.max(0, ...topics.map((topic) => topic.id)) + 1
}

/** The row 新建话题 appends; the caller stores it and announces the change. */
export function createTopic(
  topics: readonly { id: number }[],
  input: NewTopicInput,
): TopicRecord {
  return {
    id: nextTopicId(topics),
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
}

export interface TopicEditInput {
  title?: string
  iconEmojiId?: string
}

/**
 * 编辑话题's changed fields. TDLib reads an empty name as "keep the current one",
 * and `'0'` as "remove the icon"; an absent icon id also keeps it.
 */
export function topicEditPatch(input: TopicEditInput): TopicEditInput {
  return {
    ...(input.title ? { title: input.title } : {}),
    ...(input.iconEmojiId === undefined
      ? {}
      : input.iconEmojiId === '0'
        ? { iconEmojiId: undefined }
        : { iconEmojiId: input.iconEmojiId }),
  }
}

/** 置顶 / 关闭 / 免打扰: one row's flag, every other row untouched. */
export function setTopicFlag<T extends TopicFlags & { id: number }>(
  topics: readonly T[],
  topicId: number,
  flag: TopicFlag,
  value: boolean,
): T[] {
  return topics.map((topic) => (topic.id === topicId ? { ...topic, [flag]: value } : topic))
}

/** 删除话题: the row leaves the list; its messages are the caller's concern. */
export function removeTopic<T extends { id: number }>(
  topics: readonly T[],
  topicId: number,
): T[] {
  return topics.filter((topic) => topic.id !== topicId)
}

export interface TopicListInput {
  query?: string
  cursor?: { topicId: number }
  limit?: number
}

export interface TopicPageCursor {
  date: number
  messageId: number
  topicId: number
}

/**
 * One page of the topic list: the order and search rules above, the page bound
 * (1-100 rows) and the cursor the caller sends back. Rows are copied out of the
 * store so a caller cannot mutate it by accident.
 */
export function topicListPage<T extends TopicLike & { lastMessageId?: number }>(
  topics: readonly T[],
  input: TopicListInput = {},
): { topics: T[]; totalCount: number; next: TopicPageCursor | null } {
  const all = filterTopics(orderTopics(topics), input.query ?? '')
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

export interface TopicReadable {
  id: number
  unread: number
  lastReadInboxMessageId?: number
}

/**
 * 标为已读 on one topic: the chat's own read rule over this topic's rows (a report
 * that stops short of the newest row leaves the rest unread), then the row is
 * rewritten. `null` means nothing to record.
 */
export function topicRead<T extends TopicReadable>(
  topics: readonly T[],
  topicId: number,
  messages: readonly { id: number; outgoing: boolean }[],
  upToMessageId: number,
): { topics: T[]; state: ReadState } | null {
  const topic = topics.find((entry) => entry.id === topicId)
  if (!topic) return null
  const state = nextReadState(topic, messages, upToMessageId)
  if (!state) return null
  return {
    topics: topics.map((entry) =>
      entry.id === topicId
        ? { ...entry, unread: state.unread, lastReadInboxMessageId: state.lastReadInboxMessageId }
        : entry,
    ),
    state,
  }
}

/** The chat row's unread is the sum of its topics', like TDLib's chat counter. */
export function sumTopicUnread(topics: readonly { unread: number }[]): number {
  return topics.reduce((total, topic) => total + topic.unread, 0)
}

/** The custom emoji TDLib offers for a topic icon, as the fake account serves it. */
export const DEFAULT_TOPIC_ICONS: readonly { id: string; emoji: string }[] = [
  { id: '7001', emoji: '😀' },
  { id: '7002', emoji: '❤️' },
  { id: '7003', emoji: '✨' },
]
