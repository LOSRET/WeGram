import type { ChatSummary, ChatTopic, TopicIcon, TopicPage } from '@wegram/protocol'

import * as actions from './actions'
import type { ActionDeps } from './actions'

/**
 * 话题 (design doc §9.12): the list, its management calls and 以聊天方式查看.
 *
 * Split out of `index.ts` the way `chat-api.ts` / `send-api.ts` were — one more
 * domain that does not need the adapter class to grow a method per call. The deps
 * are read lazily because the class builds this object before the constructor has
 * assigned `actionDeps`.
 */
export interface TopicApiDeps {
  actionDeps: ActionDeps
  fetchChatSummary(chatId: number): Promise<ChatSummary>
}

export function createTopicApi(getDeps: () => TopicApiDeps) {
  const deps = (): ActionDeps => getDeps().actionDeps
  return {
    topics: (input: Parameters<typeof actions.topics>[1]): Promise<TopicPage> =>
      actions.topics(deps(), input),

    createTopic: (input: Parameters<typeof actions.createTopic>[1]): Promise<ChatTopic> =>
      actions.createTopic(deps(), input),

    editTopic: (input: Parameters<typeof actions.editTopic>[1]): Promise<void> =>
      actions.editTopic(deps(), input),

    setTopicPinned: (chatId: number, topicId: number, pinned: boolean): Promise<void> =>
      actions.setTopicPinned(deps(), chatId, topicId, pinned),

    setTopicClosed: (chatId: number, topicId: number, closed: boolean): Promise<void> =>
      actions.setTopicClosed(deps(), chatId, topicId, closed),

    /** 话题免打扰; the refreshed row arrives through `evt:topics`. */
    setTopicMuted: (chatId: number, topicId: number, muted: boolean): Promise<void> =>
      actions.setTopicMuted(deps(), chatId, topicId, muted),

    /** 话题图标: the custom emoji the server offers for the picker. */
    topicIcons: (): Promise<TopicIcon[]> => actions.topicIcons(deps()),

    /** 论坛展示方式: tabs or the sidebar this client draws. */
    forumLayout: (chatId: number): Promise<'tabs' | 'sidebar'> =>
      actions.forumLayout(deps(), chatId),

    deleteTopic: (chatId: number, topicId: number): Promise<void> =>
      actions.deleteTopic(deps(), chatId, topicId),

    topicLink: (chatId: number, topicId: number): Promise<{ link: string } | null> =>
      actions.topicLink(deps(), chatId, topicId),

    /** 以聊天方式查看 / 以话题方式查看; answers the refreshed chat summary. */
    setViewAsTopics: async (chatId: number, viewAsTopics: boolean): Promise<ChatSummary> => {
      await deps().invoke({
        _: 'toggleChatViewAsTopics',
        chat_id: chatId,
        view_as_topics: viewAsTopics,
      })
      return getDeps().fetchChatSummary(chatId)
    },
  }
}