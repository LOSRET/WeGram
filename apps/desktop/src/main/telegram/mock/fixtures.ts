import type { Message, MessageMedia } from '@wegram/protocol'

import { ME, at, text, type Fixture } from './constants'

type MediaOf = (
  fileId: number,
  extra?: Partial<MessageMedia>,
  options?: { downloadable?: boolean },
) => MessageMedia

/**
 * The fake account's conversations: private chats, groups, a read-only channel,
 * a managed channel, and the 5000-message stress fixture for the virtualised
 * list. Media comes from `MockAssets`, which materialised the files first.
 */
export function buildFixtures(mediaOf: MediaOf): Map<number, Fixture> {
  const fixtures = new Map<number, Fixture>()
  fixtures.set(1, {
    chat: {
      id: 1,
      title: '文件传输助手',
      kind: 'private',
      // Our own Saved Messages conversation: a chat, not a contact. The
      // 通讯录 drops it by comparing this id with `Self.id`.
      userId: ME.id,
      unread: 0,
      pinned: true,
      muted: false,
      lastMessageText: '[图片] 两段素材一起发',
      lastMessageAt: at(1),
      lastReadInboxMessageId: 106,
      lastReadOutboxMessageId: 108,
    },
    messages: [
      text(1, 101, 240, '本周的设计稿放这里', false),
      text(1, 102, 239, '收到，我晚点看', true),
      {
        id: 103,
        chatId: 1,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: at(6),
        kind: 'photo',
        text: '设计稿 v3，先看这个方向',
        media: mediaOf(7101),
      },
      {
        id: 104,
        chatId: 1,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: at(4),
        kind: 'file',
        text: '',
        media: mediaOf(7201),
      },
      {
        id: 105,
        chatId: 1,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: at(3),
        kind: 'sticker',
        text: '',
        media: mediaOf(7001, { stickerFormat: 'webp', stickerEmoji: '😀' }),
      },
      {
        id: 106,
        chatId: 1,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: at(2),
        kind: 'video',
        text: '这段录屏看一下',
        media: mediaOf(7301, { duration: 6 }),
      },
      // One Telegram album: two separate messages sharing `media_album_id`
      // (design doc §8.6). The transcript must draw them as one bubble.
      {
        id: 107,
        chatId: 1,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: at(1),
        kind: 'photo',
        text: '两段素材一起发',
        albumId: '7401',
        media: mediaOf(7101),
      },
      {
        id: 108,
        chatId: 1,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: at(1),
        kind: 'video',
        text: '',
        albumId: '7401',
        media: mediaOf(7301, { duration: 6 }),
      },
    ],
  })

  fixtures.set(2, {
    chat: {
      id: 2,
      title: 'WeGram 产品群',
      kind: 'group',
      unread: 12,
      pinned: true,
      muted: false,
      lastMessageText: '[贴纸] ✨',
      lastMessageAt: at(1),
      lastReadInboxMessageId: 204,
      lastReadOutboxMessageId: 202,
    },
    messages: [
      text(2, 201, 120, 'TDLib 的登录链路已经通了', false),
      text(2, 202, 118, '那 UI 可以对着 mock 并行做', true),
      text(2, 203, 30, '贴纸三种格式记得一起做，别留到二期', false),
      text(2, 204, 9, '虚拟列表的滚动锚定我这边先接', false),
      {
        id: 205,
        chatId: 2,
        senderId: 27,
        senderName: '成员2',
        outgoing: false,
        date: at(5),
        kind: 'photo',
        text: '截个图给你',
        media: mediaOf(7102, {}, { downloadable: true }),
      },
      {
        id: 206,
        chatId: 2,
        senderId: 27,
        senderName: '成员2',
        outgoing: false,
        date: at(2),
        kind: 'sticker',
        text: '',
        media: mediaOf(7002, { stickerFormat: 'webp', stickerEmoji: '❤️' }),
      },
      {
        id: 207,
        chatId: 2,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: at(1),
        kind: 'sticker',
        text: '',
        media: mediaOf(7003, { stickerFormat: 'tgs', stickerEmoji: '✨' }),
      },
    ],
  })

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
    contact: { username: 'mama_wegram', phone: '+86 138 0000 0000' },
  })

  fixtures.set(4, {
    chat: {
      id: 4,
      title: '前端周会',
      kind: 'group',
      unread: 3,
      pinned: false,
      muted: true,
      lastMessageText: '会议纪要已经放到共享盘',
      lastMessageAt: at(180),
      lastReadInboxMessageId: 400,
      lastReadOutboxMessageId: 0,
    },
    messages: [text(4, 401, 180, '会议纪要已经放到共享盘', false)],
  })

  fixtures.set(5, {
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
  })

  // A channel this account *does* manage: the bar shows the keyboard switch and
  // the composer opens from it. Chat 5 above is the read-only case.
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

  // A handful of private chats whose only purpose is the 通讯录: they give the
  // contact list several initials (A/B/C/D/E) and a 微信号 to show. They are
  // ordinary chats too, so 发消息 opens a transcript with one message.
  const contacts: Array<{
    id: number
    userId: number
    title: string
    messageId: number
    minutesAgo: number
    body: string
    username?: string
    phone?: string
  }> = [
    {
      id: 7,
      userId: 21,
      title: 'Ada Lovelace',
      messageId: 701,
      minutesAgo: 15,
      body: '明天图书馆见',
      username: 'ada_lovelace',
    },
    {
      id: 8,
      userId: 22,
      title: 'Ben Carter',
      messageId: 801,
      minutesAgo: 45,
      body: 'Thanks, that works!',
      username: 'ben_carter',
    },
    {
      id: 9,
      userId: 23,
      title: '陈晨',
      messageId: 901,
      minutesAgo: 120,
      body: '周末一起吃个饭？',
      username: 'chenchen',
    },
    {
      id: 10,
      userId: 24,
      title: 'Dmitri Volkov',
      messageId: 1001,
      minutesAgo: 240,
      body: 'Ок, договорились',
      username: 'dvolkov',
    },
    {
      id: 11,
      userId: 25,
      title: 'Eva Müller',
      messageId: 1101,
      minutesAgo: 360,
      body: '🎉',
      username: 'eva_m',
      phone: '+49 151 0000 0000',
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
      },
    })
  }

  // Stress fixture for the virtualised list (W2 acceptance: 5000 messages).
  const bulk: Message[] = []
  for (let index = 0; index < 5000; index += 1) {
    bulk.push({
      id: 10_000 + index,
      chatId: 99,
      senderId: index % 3 === 0 ? ME.id : 30 + (index % 5),
      senderName: index % 3 === 0 ? '我' : `成员${index % 5}`,
      outgoing: index % 3 === 0,
      date: at(600 - Math.floor(index / 10)),
      kind: 'text',
      text: `压测消息 #${index + 1}：这是一条用于验证虚拟滚动与锚定补偿的中等长度消息。`,
    })
  }
  fixtures.set(99, {
    chat: {
      id: 99,
      title: '性能测试群 · 5000 条',
      kind: 'group',
      unread: 0,
      pinned: false,
      muted: true,
      lastMessageText: bulk[bulk.length - 1]?.text ?? '',
      lastMessageAt: at(0),
      lastReadInboxMessageId: 10_000 + bulk.length - 1,
      lastReadOutboxMessageId: 0,
    },
    messages: bulk,
  })
  return fixtures
}
