import type { ContactProfile } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapUser } from './user'

/**
 * Chat peer → the identity the 通讯录 detail pane shows.
 *
 * Kept beside `mapUser` because it is the same TDLib `user` object seen from a
 * chat: the pane needs the username and the phone, not the display name (the
 * chat summary already carries the title).
 */
export function mapContactProfile(chatId: number, user: TdObject | undefined): ContactProfile {
  if (!user) return { chatId }
  const mapped = mapUser(user)
  return {
    chatId,
    ...(typeof user.id === 'number' ? { userId: user.id } : {}),
    ...(mapped.username ? { username: mapped.username } : {}),
    ...(mapped.phone ? { phone: mapped.phone } : {}),
  }
}
