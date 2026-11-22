import type { Message } from '@wegram/protocol'

import type { FixtureSeed } from './seed'

/**
 * The 通讯录 people: private chats whose purpose is the address book. They give
 * the contact list several initials and a Telegram号, and they are ordinary chats
 * too, so 发消息 opens a real transcript.
 *
 * Split out of `data.ts` when the 表情回应 + 语音 fixtures pushed that file over its
 * 550-line budget. The rows are data only: the caller's clock (`at`) and message
 * builder (`text`) come in, so the dataset keeps no clock of its own.
 */
interface ContactSeedRow {
  id: number
  userId: number
  title: string
  messageId: number
  minutesAgo: number
  body: string
  username?: string
  phone?: string
  dcId?: number
  /** 共同群聊: the fixture group chats this person shares with the account. */
  commonChatIds?: number[]
}

const CONTACT_SEEDS: readonly ContactSeedRow[] = [
  {
    id: 7,
    userId: 21,
    title: 'Ada Lovelace',
    messageId: 701,
    minutesAgo: 15,
    body: '明天图书馆见',
    username: 'ada_lovelace',
    dcId: 5,
    commonChatIds: [2],
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
    commonChatIds: [2, 4],
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

export interface ContactFixtureHelpers {
  /** Unix seconds for "this many minutes ago", from the fake's own clock. */
  at: (minutesAgo: number) => number
  /** The dataset's plain text row builder. */
  text: (chatId: number, id: number, minutesAgo: number, body: string, outgoing: boolean) => Message
}

/** Adds one private chat per address-book person, with their contact fields. */
export function addContactFixtures(
  fixtures: Map<number, FixtureSeed>,
  { at, text }: ContactFixtureHelpers,
): void {
  for (const contact of CONTACT_SEEDS) {
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
      ...(contact.commonChatIds ? { commonChatIds: contact.commonChatIds } : {}),
    })
  }
}
