/**
 * 资料卡 and 举报 of the fake account, shared by the two fakes.
 *
 * Both fakes answer the same `users:*` channels from a person the fixture data
 * already describes; the card's rules (what 备注 overrides, who may be reported,
 * which fields a bot hides) are one set of rules, not two. They had drifted: the
 * browser preview could not draw the seed's 简介 / 备注 because it read the
 * address-book row, while the mock read the seed. Structural on purpose — this
 * package imports nothing.
 */

/** One row of the 举报 sheet's reason list. */
export interface ReportOption {
  id: string
  text: string
}

/**
 * The reasons both fakes offer — an imitation of a server answer, not its content.
 *
 * A real `reportChatResultOptionRequired` carries `reportOption id/text` rows whose
 * text Telegram has already localized and whose ids are opaque bytes, so a client
 * cannot re-label them: it renders exactly what arrived. This fixture mirrors the
 * shape so the sheet is exercised at its real height, and `其他` walks the comment
 * phase (`reportChatResultTextRequired`) instead of filing straight away.
 */
export const REPORT_OPTIONS: readonly ReportOption[] = [
  { id: 'spam', text: '垃圾信息' },
  { id: 'fake', text: '假冒账号' },
  { id: 'violence', text: '涉及暴力或危险行为' },
  { id: 'child-abuse', text: '儿童虐待' },
  { id: 'pornography', text: '色情内容' },
  { id: 'illegal-drugs', text: '非法毒品' },
  { id: 'personal-details', text: '泄露个人信息' },
  { id: 'copyright', text: '侵犯版权' },
  { id: 'other', text: '其他' },
]

/** The reason that asks for details, and the *new* id the fake hands back for that step. */
const CUSTOM_REASON_ID = 'other'
const CUSTOM_DETAILS_ID = 'other-details'

/** One phase of the fake's `reportChat`, as the 举报 sheet consumes it. */
export interface FakeChatReport {
  reported: boolean
  title?: string
  options?: ReportOption[]
  textRequired?: boolean
  optionId?: string
}

/**
 * The phased answer: no reason yet → the list; `其他` → a comment step; anything
 * after that is filed. Shared by the person and the one-message report, which is
 * why both fakes walk the sheet's state machine identically.
 */
export function reportAnswer(input: {
  title: string
  optionId?: string
  /** The comment phase sends one; the fake files the report either way. */
  text?: string
}): FakeChatReport {
  if (!input.optionId) {
    return { reported: false, title: input.title, options: [...REPORT_OPTIONS] }
  }
  if (input.optionId === CUSTOM_REASON_ID) {
    return { reported: false, textRequired: true, optionId: CUSTOM_DETAILS_ID }
  }
  return { reported: true }
}

/** 机器人: the half of the card a bot adds (`userFullInfo.bot_info`). */
export interface FakeBotProfile {
  shortDescription?: string
  description?: string
  /** TDLib `botInfo.menu_button`: the Mini App the profile's 菜单 opens (§9.4). */
  menu?: { text: string; url: string }
  commands: Array<{ command: string; description: string }>
}

/** What a fake store can say about one person, before the card's overrides. */
export interface ProfileSource {
  userId: number
  title: string
  username?: string
  phone?: string
  avatarUrl?: string
  bio?: string
  /** The seed's own 备注 (`userFullInfo.note`); absent when it has none. */
  note?: string
  bot?: FakeBotProfile
  commonChats: number
}

/** What this session changed on the card; every write answers the refreshed one. */
export interface ProfileOverrides {
  note?: string
  contact?: boolean
  blocked?: boolean
}

/** The card, structurally matching `UserProfile` without importing it. */
export interface FakeUserProfile {
  userId: number
  title: string
  username?: string
  phone?: string
  avatarUrl?: string
  bio?: string
  note?: string
  commonChats: number
  isContact: boolean
  blocked: boolean
  canBeReported: boolean
  bot?: FakeBotProfile
}

/**
 * The 资料卡's rules: an override wins over the seed (including an empty 备注,
 * which clears it), a bot is never an address-book contact and is the only person
 * TDLib lets this client report.
 */
export function composeProfile(
  source: ProfileSource,
  overrides: ProfileOverrides = {},
): FakeUserProfile {
  const isBot = source.bot !== undefined
  const note = overrides.note ?? source.note
  return {
    userId: source.userId,
    title: source.title,
    ...(source.username ? { username: source.username } : {}),
    ...(source.phone ? { phone: source.phone } : {}),
    ...(source.avatarUrl ? { avatarUrl: source.avatarUrl } : {}),
    ...(source.bio ? { bio: source.bio } : {}),
    ...(note ? { note } : {}),
    commonChats: source.commonChats,
    // Everyone in the fake address book is a contact unless this session removed
    // them; a bot is never one — TDLib's `getContacts` does not list bots either.
    isContact: overrides.contact ?? !isBot,
    blocked: overrides.blocked ?? false,
    // 举报 a human is not a TDLib path (`can_report_user` wants a bot), so the card
    // mirrors the real client: only a bot is reportable.
    canBeReported: isBot,
    ...(source.bot
      ? {
          bot: {
            ...(source.bot.shortDescription
              ? { shortDescription: source.bot.shortDescription }
              : {}),
            ...(source.bot.description ? { description: source.bot.description } : {}),
            ...(source.bot.menu ? { menu: source.bot.menu } : {}),
            commands: source.bot.commands,
          },
        }
      : {}),
  }
}

/**
 * 共同群聊, one page at a time. The fixture ids act as the cursor: TDLib's
 * `offset_chat_id` means "start from this chat", which is the same as the index
 * of that id in the list.
 */
export function pageCommonChats<T extends { id: number }>(
  chats: readonly T[],
  input: { offset?: number; limit?: number } = {},
): T[] {
  const start =
    input.offset === undefined
      ? 0
      : Math.max(
          0,
          chats.findIndex((chat) => chat.id === input.offset),
        )
  return chats.slice(start, start + (input.limit ?? 50))
}
