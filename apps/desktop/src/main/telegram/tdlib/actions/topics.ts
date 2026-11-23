import { AppError } from '@wegram/protocol'
import type { ChatTopic, TopicIcon, TopicPage } from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import { mapTopic } from '../map/topic'
import type { ActionDeps } from './deps'

/**
 * 话题 (design doc §9.12): the list, its cursor and the management calls.
 *
 * TDLib pages topics by the *last message of the last topic returned* (three
 * cursor values), not by an offset. `getForumTopics` is documented as a temporary
 * method, so every write here announces `evt:topics` and the list re-reads its page
 * instead of trusting one long-lived answer.
 */

const DEFAULT_LIMIT = 50

export async function topics(
  deps: Pick<ActionDeps, 'invoke'>,
  input: {
    chatId: number
    query?: string
    cursor?: { date: number; messageId: number; topicId: number }
    limit?: number
  },
): Promise<TopicPage> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 100)
  const response = await deps.invoke({
    _: 'getForumTopics',
    chat_id: input.chatId,
    query: input.query ?? '',
    offset_date: input.cursor?.date ?? 0,
    offset_message_id: input.cursor?.messageId ?? 0,
    offset_forum_topic_id: input.cursor?.topicId ?? 0,
    limit,
  })
  const mapped = asArray<TdObject>(response?.topics)
    .map(mapTopic)
    .filter((topic) => topic.id > 0)
  // A zero next date is TDLib's "nothing after this page"; an empty page is the
  // end even when the server reported a stale cursor.
  const date = Number(response?.next_offset_date ?? 0)
  const next =
    mapped.length > 0 && date > 0
      ? {
          date,
          messageId: Number(response?.next_offset_message_id ?? 0),
          topicId: Number(response?.next_offset_forum_topic_id ?? 0),
        }
      : null
  return {
    topics: mapped,
    totalCount: Number(response?.total_count ?? mapped.length),
    next,
  }
}

/** One topic, for the caller that just created it. */
async function fetchTopic(
  deps: Pick<ActionDeps, 'invoke'>,
  chatId: number,
  topicId: number,
): Promise<ChatTopic> {
  const raw = await deps.invoke({
    _: 'getForumTopic',
    chat_id: chatId,
    forum_topic_id: topicId,
  })
  return mapTopic(raw)
}

export async function createTopic(
  deps: Pick<ActionDeps, 'invoke' | 'emit'>,
  input: { chatId: number; title: string; iconColor: number; iconEmojiId?: string },
): Promise<ChatTopic> {
  const info = await deps.invoke({
    _: 'createForumTopic',
    chat_id: input.chatId,
    name: input.title,
    is_name_implicit: false,
    icon: {
      _: 'forumTopicIcon',
      color: input.iconColor,
      custom_emoji_id: input.iconEmojiId ?? '0',
    },
  })
  const topicId = Number(info?.forum_topic_id ?? 0)
  if (!(topicId > 0)) {
    throw new AppError('internal', 'createForumTopic answered without a topic')
  }
  // The list is on screen by the time the reader returns to it.
  deps.emit({ type: 'topics', chatId: input.chatId })
  return fetchTopic(deps, input.chatId, topicId)
}

export async function editTopic(
  deps: Pick<ActionDeps, 'invoke' | 'emit'>,
  input: { chatId: number; topicId: number; title?: string; iconEmojiId?: string },
): Promise<void> {
  const editsIcon = input.iconEmojiId !== undefined
  await deps.invoke({
    _: 'editForumTopic',
    chat_id: input.chatId,
    forum_topic_id: input.topicId,
    // TDLib reads an empty name as "keep the current one".
    name: input.title ?? '',
    edit_icon_custom_emoji: editsIcon,
    icon_custom_emoji_id: input.iconEmojiId ?? '0',
  })
  deps.emit({ type: 'topics', chatId: input.chatId })
}

export async function setTopicPinned(
  deps: Pick<ActionDeps, 'invoke' | 'emit'>,
  chatId: number,
  topicId: number,
  pinned: boolean,
): Promise<void> {
  await deps.invoke({
    _: 'toggleForumTopicIsPinned',
    chat_id: chatId,
    forum_topic_id: topicId,
    is_pinned: pinned,
  })
  deps.emit({ type: 'topics', chatId })
}

export async function setTopicClosed(
  deps: Pick<ActionDeps, 'invoke' | 'emit'>,
  chatId: number,
  topicId: number,
  closed: boolean,
): Promise<void> {
  await deps.invoke({
    _: 'toggleForumTopicIsClosed',
    chat_id: chatId,
    forum_topic_id: topicId,
    is_closed: closed,
  })
  deps.emit({ type: 'topics', chatId })
}

/** 话题免打扰: `setForumTopicNotificationSettings` with the mute countdown set. */
export async function setTopicMuted(
  deps: Pick<ActionDeps, 'invoke' | 'emit'>,
  chatId: number,
  topicId: number,
  muted: boolean,
): Promise<void> {
  await deps.invoke({
    _: 'setForumTopicNotificationSettings',
    chat_id: chatId,
    forum_topic_id: topicId,
    notification_settings: {
      _: 'chatNotificationSettings',
      // A fixed countdown means "muted" for this topic; the other switches stay
      // at the client defaults so nothing but the mute changes.
      use_default_mute_for: false,
      mute_for: muted ? 2_147_483_647 : 0,
      use_default_sound: true,
      sound_id: '0',
      use_default_show_preview: true,
      show_preview: true,
      use_default_mute_stories: true,
      mute_stories: false,
      use_default_story_sound: true,
      story_sound_id: '0',
      use_default_show_story_poster: true,
      show_story_poster: true,
      use_default_disable_pinned_message_notifications: true,
      disable_pinned_message_notifications: false,
      use_default_disable_mention_notifications: true,
      disable_mention_notifications: false,
    },
  })
  deps.emit({ type: 'topics', chatId })
}

/**
 * 话题图标: the custom emoji TDLib lets this account use. A Premium account may
 * pick any emoji, but the picker only draws what the server offers here — the same
 * set the official client shows.
 */
export async function topicIcons(deps: Pick<ActionDeps, 'invoke'>): Promise<TopicIcon[]> {
  const response = await deps.invoke({ _: 'getForumTopicDefaultIcons' })
  const icons: TopicIcon[] = []
  for (const raw of asArray<TdObject>(response?.stickers)) {
    const id = String(raw.custom_emoji_id ?? '0')
    const emoji = typeof raw.emoji === 'string' ? raw.emoji : ''
    if (id === '0' || id === '' || emoji === '') continue
    icons.push({ id, emoji })
  }
  return icons
}

/**
 * 论坛展示方式: `supergroupFullInfo.has_forum_tabs` (TDLib 1.8.70). A forum keeps
 * the choice on its full info, not on the chat object, so this costs one call per
 * forum open — TDLib answers it from its own cache.
 */
export async function forumLayout(
  deps: Pick<ActionDeps, 'invoke'>,
  chatId: number,
): Promise<'tabs' | 'sidebar'> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const supergroupId = Number(chat?.type?.supergroup_id ?? 0)
  if (!(supergroupId > 0)) return 'sidebar'
  try {
    const full = await deps.invoke({
      _: 'getSupergroupFullInfo',
      supergroup_id: supergroupId,
    })
    return full?.has_forum_tabs === true ? 'tabs' : 'sidebar'
  } catch {
    // A missing full info is not worth failing the pane for.
    return 'sidebar'
  }
}

export async function deleteTopic(
  deps: Pick<ActionDeps, 'invoke' | 'emit'>,
  chatId: number,
  topicId: number,
): Promise<void> {
  await deps.invoke({
    _: 'deleteForumTopic',
    chat_id: chatId,
    forum_topic_id: topicId,
  })
  deps.emit({ type: 'topics', chatId })
}

export async function topicLink(
  deps: Pick<ActionDeps, 'invoke' | 'logger'>,
  chatId: number,
  topicId: number,
): Promise<{ link: string } | null> {
  try {
    const answer = await deps.invoke({
      _: 'getForumTopicLink',
      chat_id: chatId,
      forum_topic_id: topicId,
    })
    const link = answer?.link
    return typeof link === 'string' && link ? { link } : null
  } catch (error) {
    // A private topic this account may not link to is not worth the error bar.
    deps.logger.warn(
      `topic link ${chatId}/${topicId} unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return null
  }
}