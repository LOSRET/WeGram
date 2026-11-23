/**
 * The order and paging of a fake forum's topic list (design doc §9.12).
 *
 * Shared by the two fakes: TDLib sorts topics by its own `order` string and pages
 * them by a three-part cursor, so the fakes only have to agree on what the official
 * client shows — pinned first, then General, then the newest activity — and on what
 * a page's cursor means. Dependency-free on purpose: `@wegram/mock-session` is
 * bundled into the renderer.
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