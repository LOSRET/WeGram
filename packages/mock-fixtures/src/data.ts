import { threadInteraction } from '@wegram/mock-session'
import type { ChatTopic, Message } from '@wegram/protocol'

import { addContactFixtures } from './contacts'
import type { FixtureOptions, FixtureSeed } from './seed'
import { buildStressSeed } from './stress'
import { groupPollMessages, pollMessage } from './polls'
import { serviceMessages } from './services'
import { buildCommentThread } from './threads'

/**
 * The one sticker set the fake account's sticker messages belong to. Both fakes
 * publish it under this id, and `sticker.set_id` travels on every sticker row, so
 * clicking a fixture sticker opens the same pack box the real adapter opens.
 */
export const DEMO_STICKER_SET_ID = 'mock-stickers'

/**
 * The fake account both fakes serve: the Electron mock adapter
 * (`packages/mock-adapter`) and the browser preview (`renderer/lib/preview`).
 *
 * One copy, because the two used to drift: the preview was missing a contact,
 * disagreed on a read marker and served different media ids, so a UI change
 * verified in the browser could behave differently in Electron.
 *
 * Media is *not* here: the mock materialises real PNG/WebP/TGS files under
 * userData and mints `wx-media://` tokens, while the preview uses `data:` URLs.
 * Each side passes `mediaOf`, so a message only says which file id it carries.
 */

export function buildFixtureSeeds(options: FixtureOptions): Map<number, FixtureSeed> {
  const { selfId, mediaOf, now } = options
  const at = (minutesAgo: number): number => now() - minutesAgo * 60

  const text = (
    chatId: number,
    id: number,
    minutesAgo: number,
    body: string,
    outgoing: boolean,
  ): Message => ({
    id,
    chatId,
    senderId: outgoing ? selfId : chatId * 10 + 7,
    senderName: outgoing ? '我' : '对方',
    outgoing,
    date: at(minutesAgo),
    kind: 'text',
    text: body,
  })

  /**
   * Attach comment threads to the messages they belong to: the parent message
   * gets its `interaction` (the bar's numbers) and the replies stay out of the
   * transcript, exactly as TDLib keeps them.
   */
  const withThreads = (
    seed: FixtureSeed,
    threads: Record<number, Message[]>,
    extras: Record<number, { views?: number; forwards?: number }> = {},
  ): FixtureSeed => ({
    ...seed,
    comments: threads,
    messages: seed.messages.map((message) => {
      const thread = threads[message.id]
      if (!thread) return message
      return { ...message, interaction: threadInteraction(thread.length, extras[message.id]) }
    }),
  })

  const fixtures = new Map<number, FixtureSeed>()

  fixtures.set(1, {
    chat: {
      id: 1,
      title: '文件传输助手',
      kind: 'private',
      // Our own Saved Messages conversation: a chat, not a contact. The 通讯录
      // drops it by comparing this id with `Self.id`.
      userId: selfId,
      unread: 0,
      pinned: true,
      muted: false,
      lastMessageText: '[图片] 两段素材一起发',
      lastMessageAt: at(1),
      lastReadInboxMessageId: 107,
      lastReadOutboxMessageId: 108,
    },
    messages: [
      text(1, 101, 240, '本周的设计稿放这里', false),
      text(1, 102, 239, '收到，我晚点看', true),
      {
        id: 103,
        chatId: 1,
        senderId: selfId,
        senderName: '我',
        outgoing: true,
        date: at(6),
        kind: 'photo',
        text: '设计稿 v3，先看这个方向',
        media: mediaOf(7101, { width: 1200, height: 800, fileName: 'design-v3.png' }),
      },
      {
        id: 104,
        chatId: 1,
        senderId: selfId,
        senderName: '我',
        outgoing: true,
        date: at(4),
        kind: 'file',
        text: '',
        media: mediaOf(7201, {
          fileName: '需求说明.md',
          size: 2048,
          mimeType: 'text/markdown',
        }),
      },
      {
        id: 105,
        chatId: 1,
        senderId: selfId,
        senderName: '我',
        outgoing: true,
        date: at(3),
        kind: 'sticker',
        text: '',
        media: mediaOf(7001, {
          stickerFormat: 'webp',
          stickerEmoji: '😀',
          stickerSetId: DEMO_STICKER_SET_ID,
          width: 128,
          height: 128,
        }),
      },
      {
        id: 106,
        chatId: 1,
        senderId: selfId,
        senderName: '我',
        outgoing: true,
        date: at(2),
        kind: 'video',
        text: '这段录屏看一下',
        media: mediaOf(7301, {
          duration: 15,
          width: 720,
          height: 1280,
          mimeType: 'video/webm',
          fileName: 'demo.webm',
        }),
      },
      // One Telegram album: two messages sharing an album id (design doc §8.6).
      // The transcript must draw them as one bubble.
      {
        id: 107,
        chatId: 1,
        senderId: selfId,
        senderName: '我',
        outgoing: true,
        date: at(1),
        kind: 'photo',
        text: '两段素材一起发',
        albumId: '7401',
        media: mediaOf(7101, { width: 1200, height: 800, fileName: 'design-v3.png' }),
      },
      {
        id: 108,
        chatId: 1,
        senderId: selfId,
        senderName: '我',
        outgoing: true,
        date: at(1),
        kind: 'video',
        text: '',
        albumId: '7401',
        media: mediaOf(7301, {
          duration: 15,
          width: 720,
          height: 1280,
          mimeType: 'video/webm',
          fileName: 'demo.webm',
        }),
      },
    ],
  })

  const wegramGroup: FixtureSeed = {
    chat: {
      id: 2,
      title: 'WeGram 产品群',
      kind: 'group',
      unread: 12,
      pinned: true,
      muted: false,
      lastMessageText: '✨',
      lastMessageAt: at(0),
      lastReadInboxMessageId: 204,
      lastReadOutboxMessageId: 202,
    },
    messages: [
      text(2, 201, 120, 'TDLib 的登录链路已经通了', false),
      text(2, 202, 118, '那 UI 可以对着 mock 并行做', true),
      text(2, 203, 30, '贴纸三种格式记得一起做，别留到二期', false),
      {
        // A Telegram Premium custom emoji (§8.5): the text keeps the glyph, the
        // entity points at the ✨ TGS art both fakes serve.
        ...text(2, 204, 9, '虚拟列表的滚动锚定我这边先接 ✨', false),
        entities: [{ type: 'customEmoji', offset: 15, length: 1, customEmojiId: '7003' }],
      },
      {
        id: 205,
        chatId: 2,
        senderId: 27,
        senderName: '成员2',
        outgoing: false,
        date: at(5),
        kind: 'photo',
        text: '截个图给你',
        media: mediaOf(
          7102,
          { width: 900, height: 1200, fileName: 'sunset.png' },
          { downloadable: true },
        ),
      },
      // One open poll and one unanswered quiz; see ./polls.ts.
      ...groupPollMessages(at),
      {
        id: 206,
        chatId: 2,
        senderId: 27,
        senderName: '成员2',
        outgoing: false,
        date: at(2),
        kind: 'sticker',
        text: '',
        media: mediaOf(7002, {
          stickerFormat: 'webp',
          stickerEmoji: '❤️',
          stickerSetId: DEMO_STICKER_SET_ID,
          width: 128,
          height: 128,
        }),
      },
      {
        id: 207,
        chatId: 2,
        senderId: selfId,
        senderName: '我',
        outgoing: true,
        date: at(1),
        kind: 'sticker',
        text: '',
        media: mediaOf(7003, {
          stickerFormat: 'tgs',
          stickerEmoji: '✨',
          stickerSetId: DEMO_STICKER_SET_ID,
          width: 128,
          height: 128,
          // A Telegram Premium sticker (§8.5): one more file, the effect that
          // Telegram paints once over the artwork at 1.49× its size.
          premiumEffectFileId: 7005,
        }),
      },
      // One emoji with an animated version: Telegram draws the animated sticker
      // without a bubble, and a tap replays it with its click sound (§8.5).
      {
        ...text(2, 208, 0, '✨', false),
        kind: 'emoji',
        media: mediaOf(7003, { stickerFormat: 'tgs', stickerEmoji: '✨', soundFileId: 7004 }),
      },
    ],
  }
  // A group whose rows carry TDLib-style threads, exactly as the server hands them
  // to a discussion group: the data keeps `reply_info` and the replies, and the UI
  // must still draw no comment bar for them (design doc §9.8 — only a channel post
  // gets the handle; this fixture is what pins that gate).
  fixtures.set(
    2,
    withThreads(wegramGroup, {
      203: buildCommentThread({ chatId: 2, messageId: 203, count: 7, minutesAgo: 300, now }),
      204: buildCommentThread({ chatId: 2, messageId: 204, count: 3, minutesAgo: 60, now }),
    }),
  )

  fixtures.set(3, {
    chat: {
      id: 3,
      title: '妈',
      kind: 'private',
      userId: 37,
      unread: 3,
      pinned: false,
      muted: false,
      lastMessageText: '[图片已过期]',
      lastMessageAt: at(23),
      lastReadInboxMessageId: 301,
      lastReadOutboxMessageId: 0,
    },
    messages: [
      text(3, 301, 26, '降温了，多穿点', false),
      text(3, 302, 25, '晚上回来吃饭吗', false),
      ...serviceMessages(at),
    ],
    // Digits only: TDLib hands phone numbers over without the leading +.
    contact: {
      username: 'mama_wegram',
      phone: '8613800000000',
      dcId: 4,
      bio: '每天散步一小时。',
      note: '妈妈',
    },
    // 共同群聊: the two groups in this account she is also in.
    commonChatIds: [2, 4],
  })

  fixtures.set(4, {
    chat: {
      id: 4,
      title: '前端周会',
      kind: 'group',
      unread: 3,
      pinned: false,
      muted: true,
      lastMessageText: '完整纪要在这里 https://t.me/ada_lovelace',
      lastMessageAt: at(0),
      lastReadInboxMessageId: 400,
      lastReadOutboxMessageId: 0,
    },
    messages: [
      // 表情回应 on a received row: the chips and the chosen tint must draw
      // without a server (WeChat has no reactions; the group does).
      {
        ...text(4, 401, 180, '会议纪要已经放到共享盘', false),
        reactions: [
          { emoji: '👍', count: 3 },
          { emoji: '🎉', count: 1, chosen: true },
        ],
      },
      // 语音转文字: a voice note the reader can ask for a transcript of. The clip is
      // the mock's own tone WAV (voice playback does not care about the codec).
      {
        id: 405,
        chatId: 4,
        senderId: 23,
        senderName: '陈晨',
        outgoing: false,
        date: at(179),
        kind: 'voice',
        text: '',
        media: mediaOf(7004, { duration: 3, mimeType: 'audio/wav' }),
      },
      // A closed poll with real numbers and one answer this account already gave:
      // the card must show the bars, the percentages and the 已结束 state.
      pollMessage({
        chatId: 4,
        id: 404,
        date: at(1),
        senderId: 23,
        senderName: '陈晨',
        outgoing: false,
        question: '下个迭代先做哪个？',
        options: ['投票消息', '表情回应', '话题分组'],
        votes: [12, 5, 3],
        totalVoterCount: 20,
        chosen: [0],
        closed: true,
      }),
      // Both mention kinds the transcript can jump from (§8.3): `mention` is the
      // literal @username main resolves with `searchPublicChat`, and
      // `mentionName` already carries the user id.
      {
        ...text(4, 402, 0, '@ada_lovelace 和 陈晨 都看下这份纪要', false),
        entities: [
          { type: 'mention', offset: 0, length: 13 },
          { type: 'mentionName', offset: 16, length: 2, userId: 23 },
        ],
      },
      // A Telegram link: the transcript opens it inside the app (§8.3), so the
      // browser preview and the mock Electron window can click it through.
      {
        ...text(4, 403, 0, '完整纪要在这里 https://t.me/ada_lovelace', false),
        entities: [{ type: 'url', offset: 8, length: 25 }],
      },
    ],
  })

  const newsChannel: FixtureSeed = {
    chat: {
      id: 5,
      title: 'Telegram News',
      kind: 'channel',
      unread: 0,
      pinned: false,
      muted: false,
      lastMessageText: 'Telegram 11.0 released',
      lastMessageAt: at(600),
      lastReadInboxMessageId: 502,
      lastReadOutboxMessageId: 0,
    },
    // The channel's discussion group is not joined yet: the panel offers
    // 加入讨论组 first, like the official client does for a non-member.
    commentAccess: { joined: false, canComment: false },
    // And the channel itself starts out unjoined, like one opened from 搜索: the
    // bottom bar must offer 加入 rather than 静音, and pressing it turns this
    // fixture into the read-only subscriber case (§9.9).
    joined: false,
    messages: [
      text(5, 501, 600, 'Telegram 11.0 released', false),
      // Channel posts are sent by the chat itself (`messageSenderChat`), not by a
      // user: senderId stays 0 and senderChatId + the chat title carry the name.
      {
        id: 502,
        chatId: 5,
        senderId: 0,
        senderChatId: 5,
        senderName: 'Telegram News',
        outgoing: false,
        date: at(600),
        kind: 'text',
        text: '频道消息：发送者是频道本身',
      },
    ],
  }
  // A channel post with a linked discussion group: 78 comments, and the read /
  // forward counters the article card shows above them.
  fixtures.set(
    5,
    withThreads(
      newsChannel,
      { 502: buildCommentThread({ chatId: 5, messageId: 502, count: 78, minutesAgo: 600, now }) },
      { 502: { views: 12_400, forwards: 96 } },
    ),
  )

  // A channel this account *does* manage: the bar shows the keyboard switch and
  // the composer opens from it. Chat 5 above is the read-only case — and its
  // unjoined start is what exercises the bar's 加入 item.
  fixtures.set(6, {
    chat: {
      id: 6,
      title: 'WeGram 频道',
      kind: 'channel',
      unread: 0,
      pinned: false,
      muted: false,
      lastMessageText: '其余频道只显示静音和只读提示',
      lastMessageAt: at(90),
      lastReadInboxMessageId: 602,
      lastReadOutboxMessageId: 0,
    },
    canPost: true,
    messages: [
      {
        id: 601,
        chatId: 6,
        senderId: 0,
        senderChatId: 6,
        senderName: 'WeGram 频道',
        outgoing: false,
        date: at(120),
        kind: 'text',
        text: '这个频道由我管理：底栏有键盘按钮，可以直接发消息。',
      },
      {
        id: 602,
        chatId: 6,
        senderId: 0,
        senderChatId: 6,
        senderName: 'WeGram 频道',
        outgoing: false,
        date: at(90),
        kind: 'text',
        text: '其余频道只显示静音和只读提示',
      },
    ],
  })

  /**
   * 论坛群 (design doc §9.12): one forum with General, a pinned topic and a closed
   * one, so the topic list, the unread badges, the lock and the create path can all
   * be exercised without a real account.
   */
  const forumTopics: ChatTopic[] = [
    {
      id: 1,
      title: '综合',
      isGeneral: true,
      isClosed: false,
      isPinned: false,
      muted: false,
      iconColor: 0x6fb9f0,
      unread: 2,
      lastReadInboxMessageId: 1201,
      lastReadOutboxMessageId: 1201,
      lastMessageId: 1202,
      lastMessageText: '收到，我下午看一下',
      lastMessageAt: at(30),
    },
    {
      id: 11,
      title: '版本发布',
      isGeneral: false,
      isClosed: false,
      isPinned: true,
      muted: false,
      iconColor: 0xffd67e,
      unread: 0,
      lastReadInboxMessageId: 1211,
      lastReadOutboxMessageId: 1210,
      lastMessageId: 1211,
      lastMessageText: 'v0.3.0 已发布，安装包在 Release 里',
      lastMessageAt: at(120),
    },
    {
      id: 12,
      title: '闲聊',
      isGeneral: false,
      isClosed: true,
      isPinned: false,
      muted: false,
      iconColor: 0x8eee98,
      unread: 1,
      lastReadInboxMessageId: 1220,
      lastMessageId: 1221,
      lastMessageText: '这个话题昨天被管理员关闭了',
      lastMessageAt: at(240),
    },
  ]
  const forumMessage = (
    id: number,
    topicId: number,
    minutesAgo: number,
    body: string,
    outgoing: boolean,
  ): Message => ({
    ...text(12, id, minutesAgo, body, outgoing),
    topicId,
  })
  fixtures.set(12, {
    chat: {
      id: 12,
      title: 'WeGram 开发组',
      kind: 'group',
      unread: 3,
      pinned: false,
      muted: false,
      forum: true,
      canCreateTopic: true,
      lastMessageText: '收到，我下午看一下',
      lastMessageAt: at(30),
      lastReadInboxMessageId: 1201,
      lastReadOutboxMessageId: 0,
    },
    topics: forumTopics,
    messages: [
      forumMessage(1200, 1, 60, '今天开始接话题了，按主题聊。', false),
      forumMessage(1201, 1, 45, '好，我先把发布相关都放到「版本发布」。', true),
      forumMessage(1202, 1, 30, '收到，我下午看一下', false),
      forumMessage(1210, 11, 150, 'v0.2.9 的会话列表分页修好了。', true),
      forumMessage(1211, 11, 120, 'v0.3.0 已发布，安装包在 Release 里', false),
      forumMessage(1220, 12, 260, '周五团建有人去吗？', false),
      forumMessage(1221, 12, 240, '这个话题昨天被管理员关闭了', false),
    ],
  })

  /**
   * A bot chat: the commands it publishes (the composer's "/" list) and the
   * inline keyboard under its last message (§8.3). Both fakes serve it, so the
   * button plumbing and the command list are visible without a Telegram account.
   */
  fixtures.set(13, {
    chat: {
      id: 13,
      title: 'WeGram 助手',
      kind: 'private',
      userId: 26,
      unread: 0,
      pinned: false,
      muted: false,
      lastMessageText: '输入 /help 查看全部命令。',
      lastMessageAt: at(5),
      lastReadInboxMessageId: 1302,
      lastReadOutboxMessageId: 0,
    },
    bot: {
      commands: [
        { command: 'start', description: '重新开始' },
        { command: 'help', description: '看看我能做什么' },
        { command: 'settings', description: '设置提醒' },
      ],
    },
    messages: [
      // An outgoing command: the transcript makes it clickable (botCommand).
      {
        id: 1300,
        chatId: 13,
        senderId: selfId,
        senderName: '我',
        outgoing: true,
        date: at(60),
        kind: 'text',
        text: '/start',
        entities: [{ type: 'botCommand', offset: 0, length: 6 }],
      },
      {
        id: 1301,
        chatId: 13,
        senderId: 26,
        senderName: 'WeGram 助手',
        outgoing: false,
        date: at(30),
        kind: 'text',
        text: '你好，我是 WeGram 助手。点下面的按钮试试。',
      },
      // The inline keyboard: a callback payload, a URL and an inert copy button.
      {
        id: 1302,
        chatId: 13,
        senderId: 26,
        senderName: 'WeGram 助手',
        outgoing: false,
        date: at(5),
        kind: 'text',
        text: '输入 /help 查看全部命令。',
        entities: [{ type: 'botCommand', offset: 3, length: 5 }],
        buttons: [
          [
            { text: '设置提醒', callback: { type: 'data', data: 'settings' } },
            { text: '帮助中心', url: 'https://telegram.org/faq' },
          ],
          // A callback the mock answers with `show_alert`: the one-button dialog.
          [{ text: '弹窗提醒', callback: { type: 'data', data: 'alert' } }, { text: '复制示例' }],
        ],
      },
    ],
  })

  // The 通讯录 people (the address book's private chats) live in ./contacts.ts.
  addContactFixtures(fixtures, { at, text })

  // The virtualised list's 5000-message stress chat lives in `stress.ts`.
  fixtures.set(99, buildStressSeed({ selfId, at }))

  return fixtures
}
