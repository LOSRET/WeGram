import type { UserProfile } from '@wegram/protocol'
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

  const read = (userId: number): UserProfile => {
    const fixture = findFixture(userId)
    const override = overrides.get(userId) ?? {}
    const { chat, contact } = fixture
    const note = override.note ?? contact?.note
    return {
      userId,
      title: chat.title,
      ...(contact?.username ? { username: contact.username } : {}),
      ...(contact?.phone ? { phone: contact.phone } : {}),
      ...(chat.avatarUrl ? { avatarUrl: chat.avatarUrl } : {}),
      ...(contact?.bio ? { bio: contact.bio } : {}),
      ...(note ? { note } : {}),
      // The fixture account has no shared-group membership table.
      commonChats: 0,
      // Everyone in the fake address book is a contact unless this session
      // removed them; the card's button then offers 添加为联系人.
      isContact: override.contact ?? true,
      blocked: override.blocked ?? false,
    }
  }

  const profile = async (input: { userId: number }): Promise<UserProfile> => read(input.userId)

  /** An empty note clears it, which is how TDLib reads an empty `formattedText`. */
  const setNote = async (input: { userId: number; note: string }): Promise<UserProfile> => {
    findFixture(input.userId)
    const current = overrides.get(input.userId) ?? {}
    overrides.set(input.userId, { ...current, note: input.note.trim() })
    return read(input.userId)
  }

  const setContact = async (input: { userId: number; contact: boolean }): Promise<UserProfile> => {
    findFixture(input.userId)
    const current = overrides.get(input.userId) ?? {}
    overrides.set(input.userId, { ...current, contact: input.contact })
    return read(input.userId)
  }

  return { profile, setNote, setContact }
}
