import type { Self, UserProfile } from '@wegram/protocol'

import type { TdObject } from '../client'
import type { MapperContext } from './context'

export function mapUser(user: TdObject): Self {
  const username: string | undefined = user.usernames?.active_usernames?.[0]
  return {
    id: user.id,
    firstName: user.first_name ?? '',
    ...(user.last_name ? { lastName: user.last_name } : {}),
    ...(username ? { username } : {}),
    ...(user.phone_number ? { phone: user.phone_number } : {}),
  }
}

/** A display name the way the transcript writes it: first + last, trimmed. */
export function displayName(user: TdObject): string {
  return [user.first_name ?? '', user.last_name ?? ''].join(' ').trim()
}

/** TDLib insist on a name, and an account without one is still a person. */
export function contactName(user: TdObject): string {
  return displayName(user) || user.usernames?.active_usernames?.[0] || `用户 ${user.id}`
}

/**
 * 资料卡: TDLib splits a person over two objects — `user` (identity, contact
 * flags) and `userFullInfo` (bio, note, block state, common groups) — so the card
 * takes both. Everything optional is dropped when TDLib answered an empty string,
 * because the card draws a row only for what it has.
 */
export function mapUserProfile(
  ctx: MapperContext,
  user: TdObject,
  full: TdObject | undefined,
): UserProfile {
  const username: string | undefined = user.usernames?.active_usernames?.[0]
  const bio = textOf(full?.bio)
  const note = textOf(full?.note)
  const avatarUrl = ctx.userAvatarUrls.get(user.id)
  const commonChats = Number(full?.group_in_common_count ?? 0)
  return {
    userId: user.id,
    title: contactName(user),
    ...(username ? { username } : {}),
    ...(user.phone_number ? { phone: user.phone_number } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(bio ? { bio } : {}),
    ...(note ? { note } : {}),
    commonChats: Number.isFinite(commonChats) && commonChats > 0 ? commonChats : 0,
    isContact: Boolean(user.is_contact),
    // `block_list` is null when the person is not blocked; a non-null list is one.
    blocked: Boolean(full?.block_list && typeof full.block_list === 'object'),
  }
}

/** A TDLib `formattedText`'s plain text, or undefined when it carries none. */
function textOf(formatted: TdObject | undefined): string | undefined {
  const text = typeof formatted?.text === 'string' ? formatted.text.trim() : ''
  return text ? text : undefined
}
