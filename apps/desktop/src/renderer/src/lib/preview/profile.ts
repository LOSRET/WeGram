import type { ChatReport, Contact, UserProfile } from '@wegram/protocol'

/**
 * 资料卡 in the browser preview: the same card the mock adapter serves, derived
 * from the preview's contact rows.
 *
 * The preview has no TDLib, so "简介 / 备注" are the fixture's own fields and the
 * two writes only live in this session's map — reloading the page resets them,
 * exactly like the mock adapter's in-memory overrides.
 */
export interface PreviewProfileState {
  /** userId → what this session changed on the card. */
  overrides: Map<number, { note?: string; contact?: boolean; blocked?: boolean }>
}

export function createPreviewProfileState(): PreviewProfileState {
  return { overrides: new Map() }
}

function find(contacts: Contact[], userId: number): Contact {
  const contact = contacts.find((item) => item.userId === userId)
  if (!contact) throw { code: 'invalid_payload', message: `找不到用户 ${userId}` }
  return contact
}

function read(state: PreviewProfileState, contacts: Contact[], userId: number): UserProfile {
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
    commonChats: 0,
    isContact: override.contact ?? true,
    blocked: override.blocked ?? false,
  }
}

type PreviewProfileChannel =
  'users:profile' | 'users:setNote' | 'users:setContact' | 'users:setBlocked' | 'users:report'

export function handlePreviewProfile(
  channel: PreviewProfileChannel,
  payload: Record<string, unknown>,
  state: PreviewProfileState,
  contacts: Contact[],
): UserProfile | ChatReport {
  const userId = Number(payload['userId'])
  switch (channel) {
    case 'users:profile':
      return read(state, contacts, userId)
    case 'users:setNote': {
      const current = state.overrides.get(userId) ?? {}
      state.overrides.set(userId, { ...current, note: String(payload['note'] ?? '').trim() })
      return read(state, contacts, userId)
    }
    case 'users:setContact': {
      const current = state.overrides.get(userId) ?? {}
      state.overrides.set(userId, { ...current, contact: Boolean(payload['contact']) })
      return read(state, contacts, userId)
    }
    case 'users:setBlocked': {
      const current = state.overrides.get(userId) ?? {}
      state.overrides.set(userId, { ...current, blocked: Boolean(payload['blocked']) })
      return read(state, contacts, userId)
    }
    case 'users:report': {
      // The preview mirrors the mock: reasons first, then the report lands.
      const optionId = typeof payload['optionId'] === 'string' ? payload['optionId'] : ''
      find(contacts, userId)
      if (!optionId) {
        return {
          reported: false,
          title: '举报这个用户',
          options: [
            { id: 'spam', text: '垃圾信息' },
            { id: 'violence', text: '涉及暴力或危险行为' },
            { id: 'other', text: '其他' },
          ],
        }
      }
      return { reported: true }
    }
  }
}
