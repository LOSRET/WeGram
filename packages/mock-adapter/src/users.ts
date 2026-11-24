import { commonGroupIds, seedByUserId } from '@wegram/mock-fixtures'
import { composeProfile, pageCommonChats, reportAnswer } from '@wegram/mock-session'
import type { ProfileOverrides, ProfileSource } from '@wegram/mock-session'
import { AppError } from '@wegram/protocol'
import type { ChatReport, ChatSummary, UserProfile } from '@wegram/protocol'

import type { Fixture } from './constants'

/**
 * 资料卡 for the fake account: the person card's data and its writes (备注,
 * 添加/删除联系人, 拉黑, 举报).
 *
 * TDLib keeps a person in two objects (`user` for identity and contact flags,
 * `userFullInfo` for 简介 / 备注 / 拉黑); the fixture has one, so this module plays
 * both parts and remembers what the card can change. The card's rules and the
 * 举报 phases are `@wegram/mock-session`'s — the browser preview runs the same
 * ones. Nothing is persisted: restarting the app resets the fake account.
 */
export function createMockUsers(fixtures: Map<number, Fixture>) {
  const overrides = new Map<number, ProfileOverrides>()

  const findFixture = (userId: number): Fixture => {
    const seed = seedByUserId(fixtures, userId)
    if (!seed) throw new AppError('invalid_payload', `Mock 账号里没有用户 ${userId}`)
    return seed
  }

  /** 共同群聊: the fixture's group chats this person shares with the account. */
  const commonChatsOf = (userId: number): ChatSummary[] => {
    const person = findFixture(userId)
    return commonGroupIds(fixtures, person.chat.userId ?? 0).flatMap((id) => {
      const shared = fixtures.get(id)
      return shared ? [{ ...shared.chat }] : []
    })
  }

  /** What the seed says about the person, before this session changed anything. */
  const sourceOf = (userId: number): ProfileSource => {
    const { chat, contact, bot } = findFixture(userId)
    return {
      userId,
      title: chat.title,
      ...(contact?.username ? { username: contact.username } : {}),
      ...(contact?.phone ? { phone: contact.phone } : {}),
      ...(chat.avatarUrl ? { avatarUrl: chat.avatarUrl } : {}),
      ...(contact?.bio ? { bio: contact.bio } : {}),
      ...(contact?.note ? { note: contact.note } : {}),
      ...(bot ? { bot } : {}),
      commonChats: commonChatsOf(userId).length,
    }
  }

  const read = (userId: number): UserProfile =>
    composeProfile(sourceOf(userId), overrides.get(userId))

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
  }): Promise<ChatSummary[]> => pageCommonChats(commonChatsOf(input.userId), input)

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
