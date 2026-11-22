import type { ChatSummary, Message, MessageMedia } from '@wegram/protocol'

/**
 * The shape of the fake account's data (design doc §9.8–9.9), split out of
 * `data.ts` when that file reached its 550-line budget.
 *
 * The dataset fills these types; both fakes (the mock adapter and the browser
 * preview) read them, so a new field here is a contract change for two sides.
 */

export type SeedMedia = (
  fileId: number,
  extra?: Partial<MessageMedia>,
  options?: { downloadable?: boolean },
) => MessageMedia

/** One conversation as the fakes hold it (the mock calls this a `Fixture`). */
export interface FixtureSeed {
  chat: ChatSummary
  messages: Message[]
  /** Channels only: whether this account may post there (TDLib: admin right). */
  canPost?: boolean
  /**
   * Channels only: whether the account subscribes. A channel found in 搜索 can be
   * previewed without joining, and the bottom bar then offers 加入 (design doc
   * §9.9). Absent means joined, which is what a chat-list row always is.
   */
  joined?: boolean
  /**
   * Private chats only: the person's address-book identity (微信号 / phone).
   * The real adapter reads the same fields from TDLib's `getContacts` + `user`.
   * Phones are stored the way TDLib hands them over: digits with no leading +.
   */
  contact?: {
    username?: string
    phone?: string
    dcId?: number
    /** 简介 (`userFullInfo.bio`); the 资料卡 draws it when present. */
    bio?: string
    /** 备注 (`userFullInfo.note`) — Telegram's cloud-synced note, not a remark. */
    note?: string
  }
  /**
   * 共同群聊 (private chats only): the group chats this person shares with the
   * account — the fixture's stand-in for TDLib's `getGroupsInCommon`. The card
   * counts them and lists them when the reader opens the row.
   */
  commonChatIds?: number[]
  /**
   * Comment threads by message id (design doc §9.8). TDLib keeps them in the
   * message thread — a channel's linked discussion group — not in the transcript.
   */
  comments?: Record<number, Message[]>
  /** Comment permissions for the fake discussion groups; defaults to joined. */
  commentAccess?: {
    joined?: boolean
    canComment?: boolean
    joinByRequest?: boolean
    slowModeSeconds?: number
    banned?: boolean
  }
}

export interface FixtureOptions {
  /** Our own user id: the Saved Messages chat and every outgoing row. */
  selfId: number
  mediaOf: SeedMedia
  /** Unix seconds; each fake reads its own clock. */
  now: () => number
}
