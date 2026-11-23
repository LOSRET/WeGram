import type { MessageEntity, Self, UserProfile } from '@wegram/protocol'

import type { TdObject } from '../client'
import type { MapperContext } from './context'
import { mapEntities } from './entities'

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
  /** TDLib's `chat.can_be_reported` for the private chat (bots only). */
  canBeReported: boolean,
): UserProfile {
  const username: string | undefined = user.usernames?.active_usernames?.[0]
  const bio = formattedOf(full?.bio)
  const note = textOf(full?.note)
  const avatarUrl = ctx.userAvatarUrls.get(user.id)
  const commonChats = Number(full?.group_in_common_count ?? 0)
  return {
    userId: user.id,
    title: contactName(user),
    ...(username ? { username } : {}),
    ...(user.phone_number ? { phone: user.phone_number } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(bio ? { bio: bio.text } : {}),
    ...(bio && bio.entities.length > 0 ? { bioEntities: bio.entities } : {}),
    ...(note ? { note } : {}),
    commonChats: Number.isFinite(commonChats) && commonChats > 0 ? commonChats : 0,
    isContact: Boolean(user.is_contact),
    // `block_list` is null when the person is not blocked; a non-null list is one.
    blocked: Boolean(full?.block_list && typeof full.block_list === 'object'),
    canBeReported,
  }
}

/** A TDLib `formattedText`'s plain text, or undefined when it carries none. */
function textOf(formatted: TdObject | undefined): string | undefined {
  const text = typeof formatted?.text === 'string' ? formatted.text.trim() : ''
  return text ? text : undefined
}

/**
 * A TDLib `formattedText` as the card draws it: trimmed text plus its entities.
 *
 * The offsets travel with the text, so trimming rebases them by the leading
 * whitespace that was cut (TDLib usually pads nothing, but a shifted mention would
 * underline the wrong words). Entities that would fall outside the trimmed text
 * are dropped instead of clamped — a link nobody can see is not a link.
 */
function formattedOf(
  formatted: TdObject | undefined,
): { text: string; entities: MessageEntity[] } | undefined {
  const raw = typeof formatted?.text === 'string' ? formatted.text : ''
  const text = raw.trim()
  if (!text) return undefined
  const lead = raw.length - raw.trimStart().length
  const entities = mapEntities(formatted?.entities)
    .map((entity) => ({ ...entity, offset: entity.offset - lead }))
    .filter((entity) => entity.offset >= 0 && entity.offset + entity.length <= text.length)
  return { text, entities }
}
