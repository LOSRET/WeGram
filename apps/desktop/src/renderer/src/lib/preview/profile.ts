import { composeProfile, pageCommonChats, reportAnswer } from '@wegram/mock-session'
import type { FakeBotProfile, ProfileOverrides } from '@wegram/mock-session'
import type { ChatReport, ChatSummary, UserProfile } from '@wegram/protocol'

/**
 * 资料卡 in the browser preview: the same card the mock adapter serves, derived
 * from the fixture seed. The rules (what 备注 overrides, who may be reported,
 * which fields a bot hides) are `@wegram/mock-session`'s, so the two fakes cannot
 * disagree about a card.
 *
 * The preview has no TDLib, so the two writes only live in this session's map —
 * reloading the page resets them, exactly like the mock adapter's in-memory
 * overrides.
 */
export interface PreviewProfileState {
  /** userId → what this session changed on the card. */
  overrides: Map<number, ProfileOverrides>
}

/** What the fixture seed knows about one person, as the card reads it. */
export interface PreviewPerson {
  userId: number
  title: string
  username?: string
  phone?: string
  avatarUrl?: string
  bio?: string
  note?: string
  bot?: FakeBotProfile
}

export const PROFILE_CHANNELS = [
  'users:profile',
  'users:setNote',
  'users:setContact',
  'users:setBlocked',
  'users:report',
  'users:commonChats',
  'messages:report',
] as const

export type PreviewProfileChannel = (typeof PROFILE_CHANNELS)[number]

export function isProfileChannel(channel: string): channel is PreviewProfileChannel {
  return (PROFILE_CHANNELS as readonly string[]).includes(channel)
}

export function createPreviewProfileState(): PreviewProfileState {
  return { overrides: new Map() }
}

export function handlePreviewProfile(
  channel: PreviewProfileChannel,
  payload: Record<string, unknown>,
  state: PreviewProfileState,
  personFor: (userId: number) => PreviewPerson | null,
  commonChatsFor: (userId: number) => ChatSummary[],
): UserProfile | ChatReport | ChatSummary[] {
  const userId = Number(payload['userId'])
  const optionId =
    typeof payload['optionId'] === 'string' ? payload['optionId'] : undefined

  const requirePerson = (): PreviewPerson => {
    const person = personFor(userId)
    if (!person) throw { code: 'invalid_payload', message: `找不到用户 ${userId}` }
    return person
  }

  const read = (): UserProfile =>
    composeProfile(
      { ...requirePerson(), commonChats: commonChatsFor(userId).length },
      state.overrides.get(userId),
    )

  const override = (patch: ProfileOverrides): UserProfile => {
    const current = state.overrides.get(userId) ?? {}
    state.overrides.set(userId, { ...current, ...patch })
    return read()
  }

  switch (channel) {
    case 'users:profile':
      return read()
    case 'users:setNote':
      return override({ note: String(payload['note'] ?? '').trim() })
    case 'users:setContact':
      return override({ contact: Boolean(payload['contact']) })
    case 'users:setBlocked':
      return override({ blocked: Boolean(payload['blocked']) })
    case 'users:commonChats': {
      // The fixture ids play TDLib's `offset_chat_id`: continue from that chat.
      return pageCommonChats(commonChatsFor(userId), {
        ...(typeof payload['offset'] === 'number' ? { offset: payload['offset'] } : {}),
        ...(typeof payload['limit'] === 'number' ? { limit: payload['limit'] } : {}),
      })
    }
    case 'users:report':
      // The reasons come first; a bot is reportable, a person is not.
      requirePerson()
      return reportAnswer({ title: '举报这个用户', ...(optionId ? { optionId } : {}) })
    case 'messages:report':
      return reportAnswer({ title: '举报这条消息', ...(optionId ? { optionId } : {}) })
  }
}
