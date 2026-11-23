import { describe, expect, it } from 'vitest'

import { mapTopic, mapTopicInfo } from './topic'

/** A `forumTopic` the way TDLib 1.8.70 sends it. */
function rawTopic(overrides: Record<string, unknown> = {}) {
  return {
    _: 'forumTopic',
    info: {
      _: 'forumTopicInfo',
      chat_id: 12,
      forum_topic_id: 11,
      name: '版本发布',
      icon: { _: 'forumTopicIcon', color: 0xffd67e, custom_emoji_id: '0' },
      creation_date: 1_760_000_000,
      creator_id: { _: 'messageSenderUser', user_id: 1000 },
      is_general: false,
      is_outgoing: true,
      is_closed: false,
      is_hidden: false,
      is_name_implicit: false,
    },
    last_message: {
      _: 'message',
      id: 1211,
      chat_id: 12,
      date: 1_760_000_600,
      content: { _: 'messageText', text: { _: 'formattedText', text: 'v0.3.0 已发布' } },
    },
    order: '7',
    is_pinned: true,
    unread_count: 2,
    last_read_inbox_message_id: 1202,
    last_read_outbox_message_id: 0,
    unread_mention_count: 0,
    unread_reaction_count: 0,
    unread_poll_vote_count: 0,
    ...overrides,
  }
}

describe('mapTopic', () => {
  it('maps the row the list draws', () => {
    const topic = mapTopic(rawTopic())
    expect(topic).toMatchObject({
      id: 11,
      title: '版本发布',
      isGeneral: false,
      isClosed: false,
      isPinned: true,
      iconColor: 0xffd67e,
      unread: 2,
      lastReadInboxMessageId: 1202,
      lastMessageId: 1211,
      lastMessageText: 'v0.3.0 已发布',
    })
    expect(topic.iconEmojiId).toBeUndefined()
  })

  it("carries the topic's own outgoing read marker (our rows' 已读)", () => {
    expect(mapTopic(rawTopic()).lastReadOutboxMessageId).toBeUndefined()
    expect(mapTopic(rawTopic({ last_read_outbox_message_id: 1205 })).lastReadOutboxMessageId).toBe(
      1205,
    )
  })

  it('keeps a custom-emoji icon as its int64 string', () => {
    const raw = rawTopic()
    raw.info = {
      ...raw.info,
      icon: { _: 'forumTopicIcon', color: 0x6fb9f0, custom_emoji_id: '5368324170671202286' },
    }
    expect(mapTopic(raw).iconEmojiId).toBe('5368324170671202286')
  })

  it("reads 免打扰 from the topic's own notification settings", () => {
    const raw = rawTopic({
      notification_settings: {
        _: 'chatNotificationSettings',
        use_default_mute_for: false,
        mute_for: 3600,
      },
    })
    expect(mapTopic(raw).muted).toBe(true)
    const unmuted = rawTopic({
      notification_settings: {
        _: 'chatNotificationSettings',
        use_default_mute_for: true,
        mute_for: 3600,
      },
    })
    expect(mapTopic(unmuted).muted).toBe(false)
  })

  it('reads General and a closed topic from their flags', () => {
    const raw = rawTopic()
    raw.info = { ...raw.info, forum_topic_id: 1, is_general: true, is_closed: true }
    const topic = mapTopic(raw)
    expect(topic.id).toBe(1)
    expect(topic.isGeneral).toBe(true)
    expect(topic.isClosed).toBe(true)
  })

  it('leaves the last-message fields out for a topic with no messages', () => {
    const topic = mapTopic(rawTopic({ last_message: undefined, unread_count: 0 }))
    expect(topic.lastMessageId).toBeUndefined()
    expect(topic.lastMessageText).toBeUndefined()
    expect(topic.lastMessageAt).toBeUndefined()
  })

  it('maps a bare forumTopicInfo (createForumTopic / updateForumTopicInfo)', () => {
    const info = rawTopic().info
    const topic = mapTopicInfo(info)
    expect(topic).toMatchObject({ id: 11, title: '版本发布', unread: 0, isPinned: false })
    expect(topic.lastMessageId).toBeUndefined()
  })
})
