import type { ChatReport, ChatSummary, UserProfile } from '@wegram/protocol'
import { AppError } from '@wegram/protocol'

import type { Fixture } from './constants'

/**
 * 资料卡 for the fake account: the person card's data and its two writes (备注 and
 * 添加/删除联系人).
 *
 * TDLib keeps a person in two objects (`user` for identity and contact flags,
 * `userFullInfo` for 简介 / 备注 / 拉黑); the fixture has one, so this module plays
 * both parts and remembers the two things the card can change. Nothing is
 * persisted: restarting the app resets the fake account, like every other fixture.
 */
/**
 * The reasons the sheet shows — an imitation of a server answer, not its content.
 *
 * A real `reportChatResultOptionRequired` carries `reportOption id/text` rows whose
 * text Telegram has already localized, and whose ids are opaque bytes (1.8.70 has no
 * `type` field on the option), so a client cannot re-label them: it renders exactly
 * what arrived. The list is not the `ReportReason` enum either — that enum is only an
 * *input* (`reportChatPhoto`), and real dialogs offer labels outside it. This fixture
 * mirrors the shape so the sheet is exercised at its real height, and `其他` walks the
 * comment phase (`reportChatResultTextRequired`) instead of filing straight away.
 */
const REPORT_OPTIONS = [
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

/** The reason that asks for details, and the *new* id TDLib hands back for that step. */
const CUSTOM_REASON_ID = 'other'
const CUSTOM_DETAILS_ID = 'other-details'

/**
 * One phase of the fake's `reportChat`: no reason yet → the list; `其他` → a
 * comment step, exactly like `reportChatResultTextRequired`; anything after that
 * is filed. Shared by the person and the one-message path.
 */
function reportAnswer(input: { title: string; optionId?: string }): ChatReport {
  if (!input.optionId) return { reported: false, title: input.title, options: REPORT_OPTIONS }
  if (input.optionId === CUSTOM_REASON_ID) {
    return { reported: false, textRequired: true, optionId: CUSTOM_DETAILS_ID }
  }
  return { reported: true }
}

interface Overrides {
  note?: string
  contact?: boolean
  blocked?: boolean
}

export function createMockUsers(fixtures: Map<number, Fixture>) {
  const overrides = new Map<number, Overrides>()

  const findFixture = (userId: number): Fixture => {
    for (const fixture of fixtures.values()) {
      if (fixture.chat.userId === userId) return fixture
    }
    throw new AppError('invalid_payload', `Mock 账号里没有用户 ${userId}`)
  }

  /** 共同群聊: the fixture's group chats this person shares with the account. */
  const commonChatsOf = (userId: number): ChatSummary[] => {
    const fixture = findFixture(userId)
    return (fixture.commonChatIds ?? []).flatMap((id) => {
      const shared = fixtures.get(id)
      return shared?.chat.kind === 'group' ? [{ ...shared.chat }] : []
    })
  }

  const read = (userId: number): UserProfile => {
    const fixture = findFixture(userId)
    const override = overrides.get(userId) ?? {}
    const { chat, contact, bot } = fixture
    const note = override.note ?? contact?.note
    return {
      userId,
      title: chat.title,
      ...(contact?.username ? { username: contact.username } : {}),
      ...(contact?.phone ? { phone: contact.phone } : {}),
      ...(chat.avatarUrl ? { avatarUrl: chat.avatarUrl } : {}),
      ...(contact?.bio ? { bio: contact.bio } : {}),
      ...(note ? { note } : {}),
      commonChats: commonChatsOf(userId).length,
      // Everyone in the fake address book is a contact unless this session
      // removed them; the card's button then offers 添加为联系人. A bot is never
      // one — TDLib's `getContacts` does not list bots either.
      isContact: override.contact ?? !bot,
      // 举报 a human is not a TDLib path (`can_report_user` wants a bot), so the
      // card mirrors the real client: only the fixture bot is reportable.
      canBeReported: Boolean(bot),
      blocked: override.blocked ?? false,
      // 机器人 (§8.3): the profile page's 简介, the welcome text and the commands,
      // all from the seed's `bot_info` stand-in.
      ...(bot
        ? {
            bot: {
              ...(bot.shortDescription ? { shortDescription: bot.shortDescription } : {}),
              ...(bot.description ? { description: bot.description } : {}),
              commands: bot.commands,
            },
          }
        : {}),
    }
  }

  const profile = async (input: { userId: number }): Promise<UserProfile> => read(input.userId)

  /**
   * 共同群聊, one page at a time. The fixture ids act as the cursor: TDLib's
   * `offset_chat_id` means "start from this chat", which is the same as the index
   * of that id in the list.
   */
  const commonChats = async (input: {
    userId: number
    offset?: number
    limit?: number
  }): Promise<ChatSummary[]> => {
    const all = commonChatsOf(input.userId)
    const start =
      input.offset === undefined
        ? 0
        : Math.max(
            0,
            all.findIndex((chat) => chat.id === input.offset),
          )
    return all.slice(start, start + (input.limit ?? 50))
  }

  /** An empty note clears it, which is how TDLib reads an empty `formattedText`. */
  const setNote = async (input: { userId: number; note: string }): Promise<UserProfile> => {
    findFixture(input.userId)
    const current = overrides.get(input.userId) ?? {}
    overrides.set(input.userId, { ...current, note: input.note.trim() })
    return read(input.userId)
  }

  const setBlocked = async (input: { userId: number; blocked: boolean }): Promise<UserProfile> => {
    findFixture(input.userId)
    const current = overrides.get(input.userId) ?? {}
    overrides.set(input.userId, { ...current, blocked: input.blocked })
    return read(input.userId)
  }

  /**
   * 举报: the fake files it at once, but the answer keeps TDLib's two-phase shape
   * so the sheet's state machine is the same against the mock as against the
   * server — the first call names the reasons, the second one reports.
   */
  const report = async (input: {
    userId: number
    optionId?: string
    text?: string
  }): Promise<ChatReport> => {
    findFixture(input.userId)
    return reportAnswer({ title: '举报这个用户', ...input })
  }

  /**
   * 举报 one message: the fake files it at once, with the same phases as the
   * person path — the transcript's menu must not need a mock-only branch.
   */
  const reportMessage = async (input: {
    chatId: number
    messageId: number
    optionId?: string
    text?: string
  }): Promise<ChatReport> => reportAnswer({ title: '举报这条消息', ...input })

  const setContact = async (input: { userId: number; contact: boolean }): Promise<UserProfile> => {
    findFixture(input.userId)
    const current = overrides.get(input.userId) ?? {}
    overrides.set(input.userId, { ...current, contact: input.contact })
    return read(input.userId)
  }

  return { profile, commonChats, setNote, setContact, setBlocked, report, reportMessage }
}
