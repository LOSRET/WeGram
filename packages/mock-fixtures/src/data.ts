import { threadInteraction } from '@wegram/mock-session'
import type { Message } from '@wegram/protocol'

import type { FixtureOptions, FixtureSeed } from './seed'
import { buildStressSeed } from './stress'
import { groupPollMessages, pollMessage } from './polls'
import { buildCommentThread } from './threads'

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
      unread: 1,
      pinned: false,
      muted: false,
      lastMessageText: '晚上回来吃饭吗',
      lastMessageAt: at(25),
      lastReadInboxMessageId: 301,
      lastReadOutboxMessageId: 0,
    },
    messages: [
      text(3, 301, 26, '降温了，多穿点', false),
      text(3, 302, 25, '晚上回来吃饭吗', false),
    ],
    // Digits only: TDLib hands phone numbers over without the leading +.
    contact: { username: 'mama_wegram', phone: '8613800000000', dcId: 4 },
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
      text(4, 401, 180, '会议纪要已经放到共享盘', false),
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

  // Private chats whose purpose is the 通讯录: they give the contact list several
  // initials and a 微信号, and are ordinary chats too, so 发消息 opens a transcript.
  const contacts: Array<{
    id: number
    userId: number
    title: string
    messageId: number
    minutesAgo: number
    body: string
    username?: string
    phone?: string
    dcId?: number
  }> = [
    {
      id: 7,
      userId: 21,
      title: 'Ada Lovelace',
      messageId: 701,
      minutesAgo: 15,
      body: '明天图书馆见',
      username: 'ada_lovelace',
      dcId: 5,
    },
    {
      id: 8,
      userId: 22,
      title: 'Ben Carter',
      messageId: 801,
      minutesAgo: 45,
      body: 'Thanks, that works!',
      username: 'ben_carter',
      dcId: 5,
    },
    {
      id: 9,
      userId: 23,
      title: '陈晨',
      messageId: 901,
      minutesAgo: 120,
      body: '周末一起吃个饭？',
      username: 'chenchen',
      dcId: 1,
    },
    {
      id: 10,
      userId: 24,
      title: 'Dmitri Volkov',
      messageId: 1001,
      minutesAgo: 240,
      body: 'Ок, договорились',
      username: 'dvolkov',
      dcId: 4,
    },
    {
      id: 11,
      userId: 25,
      title: 'Eva Müller',
      messageId: 1101,
      minutesAgo: 360,
      body: '🎉',
      username: 'eva_m',
      phone: '4915100000000',
      dcId: 5,
    },
  ]

  for (const contact of contacts) {
    fixtures.set(contact.id, {
      chat: {
        id: contact.id,
        title: contact.title,
        kind: 'private',
        userId: contact.userId,
        unread: 0,
        pinned: false,
        muted: false,
        lastMessageText: contact.body,
        lastMessageAt: at(contact.minutesAgo),
        lastReadInboxMessageId: contact.messageId,
        lastReadOutboxMessageId: 0,
      },
      messages: [text(contact.id, contact.messageId, contact.minutesAgo, contact.body, false)],
      contact: {
        ...(contact.username ? { username: contact.username } : {}),
        ...(contact.phone ? { phone: contact.phone } : {}),
        ...(contact.dcId ? { dcId: contact.dcId } : {}),
      },
    })
  }

  // The virtualised list's 5000-message stress chat lives in `stress.ts`.
  fixtures.set(99, buildStressSeed({ selfId, at }))

  return fixtures
}
