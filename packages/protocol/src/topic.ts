import { z } from 'zod'

/**
 * 话题 (Telegram forums, design doc §9.12).
 *
 * A forum supergroup shows one list of topics; every message belongs to exactly
 * one of them (`Message.topicId`), and the client reads one topic at a time.
 * TDLib 1.8.70 calls the id `forum_topic_id` — the older `message_thread_id`
 * is a different concept (a message thread) and must not be mixed in.
 *
 * The General topic always has id 1; a message may arrive without a topic, which
 * the mapper reads as General.
 */

/** The General topic's id, fixed by Telegram. */
export const GENERAL_TOPIC_ID = 1

/**
 * The six colours Telegram offers for a topic icon (TDLib's `forumTopicIcon.color`
 * documents exactly these). Kept here so 新建话题 validates what the server accepts.
 */
export const TOPIC_ICON_COLORS = [
  0x6fb9f0, 0xffd67e, 0xcb86db, 0x8eee98, 0xff93b2, 0xfb6f5f,
] as const

export const chatTopicSchema = z.object({
  /** TDLib `forumTopicInfo.forum_topic_id`; 1 is General (`isGeneral`). */
  id: z.number().int().positive(),
  title: z.string(),
  /** 综合: always id 1, cannot be deleted, has no icon of its own by default. */
  isGeneral: z.boolean(),
  /** 已关闭: readable, but only its creator / admins may post. */
  isClosed: z.boolean(),
  /** 免打扰 for this topic only (TDLib's own notification settings on the row). */
  muted: z.boolean(),
  isPinned: z.boolean(),
  /** 0xRRGGBB, straight from TDLib; the renderer turns it into a CSS colour. */
  iconColor: z.number().int().nonnegative(),
  /** Custom-emoji id of the icon, as a string (int64), absent when it has none. */
  iconEmojiId: z.string().optional(),
  /** Unread messages in this topic; the chat row keeps the whole chat's total. */
  unread: z.number().int().nonnegative(),
  /** Highest incoming message the server counts as read inside this topic. */
  lastReadInboxMessageId: z.number().int().nonnegative().optional(),
  /**
   * Highest outgoing message the members have read inside this topic: the source
   * of the 已读/未读 receipt on our own rows. A forum keeps this marker per topic
   * (TDLib `forumTopic.last_read_outbox_message_id`); the chat-level one only
   * describes the General topic.
   */
  lastReadOutboxMessageId: z.number().int().nonnegative().optional(),
  /** Newest message of the topic; absent while it has none (a just-created one). */
  lastMessageId: z.number().int().positive().optional(),
  lastMessageText: z.string().optional(),
  /** [start, end) spoiler runs of `lastMessageText`, like the chat row's. */
  lastMessageSpoilers: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
  lastMessageAt: z.number().int().optional(),
})
export type ChatTopic = z.infer<typeof chatTopicSchema>

/**
 * Where `chats:topics` continues. TDLib pages topics by the *last message* of the
 * last one returned (three values), not by a numeric offset, so this is one cursor
 * object rather than an offset — and an empty `topics` answer is the end.
 */
export const topicCursorSchema = z.object({
  date: z.number().int().nonnegative(),
  messageId: z.number().int().nonnegative(),
  topicId: z.number().int().nonnegative(),
})
export type TopicCursor = z.infer<typeof topicCursorSchema>

/**
 * 话题图标: the custom emoji TDLib offers for a topic icon (`getForumTopicDefaultIcons`).
 * Telegram Premium accounts may pick any custom emoji; everyone else gets this set,
 * so the picker draws exactly what the server accepts.
 */
export const topicIconSchema = z.object({
  /** Custom-emoji id, as an int64 string. */
  id: z.string(),
  /** The emoji the art stands for; the picker's alt text and fallback glyph. */
  emoji: z.string(),
})
export type TopicIcon = z.infer<typeof topicIconSchema>

export const topicPageSchema = z.object({
  topics: z.array(chatTopicSchema),
  /** Approximate total the server knows; the search answer may be larger than a page. */
  totalCount: z.number().int().nonnegative(),
  /** `null` when the page is the last one. */
  next: topicCursorSchema.nullable(),
})
export type TopicPage = z.infer<typeof topicPageSchema>
