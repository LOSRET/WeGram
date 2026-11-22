import type { ChatReport, ChatSummary, Contact, UserProfile } from '@wegram/protocol'

/**
 * 资料卡 in the browser preview: the same card the mock adapter serves, derived
 * from the preview's contact rows.
 *
 * The preview has no TDLib, so "简介 / 备注" are the fixture's own fields and the
 * two writes only live in this session's map — reloading the page resets them,
 * exactly like the mock adapter's in-memory overrides.
 *
 * The channel list lives here too: the preview's invoke switch routes the whole
 * person domain through `isPreviewProfileChannel`, so a new card write costs one
 * array entry instead of another `case` in a file that is at its line budget.
 */
export interface PreviewProfileState {
  /** userId → what this session changed on the card. */
  overrides: Map<number, { note?: string; contact?: boolean; blocked?: boolean }>
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

/**
 * The preview's reasons: an imitation of a server answer. The real list and its
 * localized text come from Telegram (`reportOption id/text` rows; the ids are opaque
 * and 1.8.70 has no `type` field), so it can differ from this fixture — the shape is
 * what matters: a tall list, and `其他` asking for details like
 * `reportChatResultTextRequired`. The mock adapter answers the same list.
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

const CUSTOM_REASON_ID = 'other'
const CUSTOM_DETAILS_ID = 'other-details'

/** One phase of the preview's phased answer, shared by both report targets. */
function reportAnswer(title: string, optionId: string): ChatReport {
  if (!optionId) return { reported: false, title, options: REPORT_OPTIONS }
  if (optionId === CUSTOM_REASON_ID) {
    return { reported: false, textRequired: true, optionId: CUSTOM_DETAILS_ID }
  }
  return { reported: true }
}

export type PreviewProfileChannel = (typeof PROFILE_CHANNELS)[number]

export function isProfileChannel(channel: string): channel is PreviewProfileChannel {
  return (PROFILE_CHANNELS as readonly string[]).includes(channel)
}

export function createPreviewProfileState(): PreviewProfileState {
  return { overrides: new Map() }
}

function find(contacts: Contact[], userId: number): Contact {
  const contact = contacts.find((item) => item.userId === userId)
  if (!contact) throw { code: 'invalid_payload', message: `找不到用户 ${userId}` }
  return contact
}

function read(
  state: PreviewProfileState,
  contacts: Contact[],
  commonChatsFor: (userId: number) => ChatSummary[],
  userId: number,
): UserProfile {
  const contact = find(contacts, userId)
  const override = state.overrides.get(userId) ?? {}
  const note = override.note
  return {
    userId: contact.userId,
    title: contact.title,
    ...(contact.username ? { username: contact.username } : {}),
    ...(contact.phone ? { phone: contact.phone } : {}),
    ...(contact.avatarUrl ? { avatarUrl: contact.avatarUrl } : {}),
    ...(note ? { note } : {}),
    commonChats: commonChatsFor(userId).length,
    isContact: override.contact ?? true,
    blocked: override.blocked ?? false,
    // Same rule as the mock: a human is not reportable from a profile (TDLib
    // reports bots only), so the card's 举报 stays hidden.
    canBeReported: false,
  }
}

export function handlePreviewProfile(
  channel: PreviewProfileChannel,
  payload: Record<string, unknown>,
  state: PreviewProfileState,
  contacts: Contact[],
  commonChatsFor: (userId: number) => ChatSummary[],
): UserProfile | ChatReport | ChatSummary[] {
  const userId = Number(payload['userId'])
  switch (channel) {
    case 'users:profile':
      return read(state, contacts, commonChatsFor, userId)
    case 'users:setNote': {
      const current = state.overrides.get(userId) ?? {}
      state.overrides.set(userId, { ...current, note: String(payload['note'] ?? '').trim() })
      return read(state, contacts, commonChatsFor, userId)
    }
    case 'users:setContact': {
      const current = state.overrides.get(userId) ?? {}
      state.overrides.set(userId, { ...current, contact: Boolean(payload['contact']) })
      return read(state, contacts, commonChatsFor, userId)
    }
    case 'users:setBlocked': {
      const current = state.overrides.get(userId) ?? {}
      state.overrides.set(userId, { ...current, blocked: Boolean(payload['blocked']) })
      return read(state, contacts, commonChatsFor, userId)
    }
    case 'users:commonChats': {
      // The fixture ids play TDLib's `offset_chat_id`: continue from that chat.
      const all = commonChatsFor(userId)
      const offset = payload['offset']
      const start =
        typeof offset === 'number'
          ? Math.max(
              0,
              all.findIndex((chat) => chat.id === offset),
            )
          : 0
      const limit = typeof payload['limit'] === 'number' ? payload['limit'] : 50
      return all.slice(start, start + limit)
    }
    case 'users:report': {
      // The preview mirrors the mock: reasons first, then the report lands.
      find(contacts, userId)
      return reportAnswer(
        '举报这个用户',
        typeof payload['optionId'] === 'string' ? payload['optionId'] : '',
      )
    }
    case 'messages:report':
      return reportAnswer(
        '举报这条消息',
        typeof payload['optionId'] === 'string' ? payload['optionId'] : '',
      )
  }
}
