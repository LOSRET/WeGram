import type { SliceCreator, TopicActions } from '../types'

/**
 * 话题 (design doc §9.12): the list a forum shows and which topic the reader is in.
 *
 * The list is cached per chat and refreshed when `evt:topics` says TDLib changed
 * something — a rename, a pin, a close or a deletion only arrive as half an
 * object, so re-reading the page is the honest answer (`noteTopicsChanged`).
 */
export const createTopicsSlice: SliceCreator<TopicActions> = (set) => ({
  setTopics: (chatId, topics) =>
    set((state) => ({
      topicsByChat: { ...state.topicsByChat, [chatId]: topics },
    })),

  /** One more page: rows already known keep their position, new ones append. */
  mergeTopics: (chatId, topics) =>
    set((state) => {
      const existing = state.topicsByChat[chatId] ?? []
      const seen = new Set(existing.map((topic) => topic.id))
      const fresh = topics.filter((topic) => !seen.has(topic.id))
      if (fresh.length === 0) return {}
      return {
        topicsByChat: { ...state.topicsByChat, [chatId]: [...existing, ...fresh] },
      }
    }),

  /**
   * `evt:topics`: bump the version the list hook watches. A read counter or a
   * rename is part of the same stream, so one bump covers every kind of change.
   */
  noteTopicsChanged: () =>
    set((state) => ({ topicsVersion: state.topicsVersion + 1 })),

  /**
   * Entering a topic only selects it: the transcript in memory stays as it is, and
   * `historyTopicByChat` keeps saying which topic it belongs to. `useChatHistory`
   * compares the two — a mismatch is "fetch this topic's first page" and the pane
   * draws a loading state rather than another topic's rows. Dropping the rows here
   * instead made a reopened forum flash "not synced" while the query's cached page
   * and the emptied store disagreed.
   */
  setActiveTopic: (topicId) => set({ activeTopicId: topicId }),

  setForumLayout: (chatId, layout) =>
    set((state) => ({
      forumLayoutByChat: { ...state.forumLayoutByChat, [chatId]: layout },
    })),
})