import type { Contact } from '@wegram/protocol'

import type { TdObject } from '../client'
import { dcIdFromRemoteFileId } from '../file-dc'
import type { MapperContext } from './context'
import { mapUser } from './user'

/**
 * One address-book row: a TDLib `user` seen as a 通讯录 entry.
 *
 * The title is the person's name because the 通讯录 groups by it; the private
 * chat (and with it the chat title, which may be an alias) is not needed until
 * the card's 发消息 is pressed. The photo comes from the avatar cache when it
 * has already been downloaded — otherwise the row draws initials until
 * `evt:avatars` hands the picture over.
 */
export function mapContact(ctx: MapperContext, user: TdObject): Contact {
  const mapped = mapUser(user)
  const name = [mapped.firstName, mapped.lastName]
    .filter((part): part is string => Boolean(part))
    .join(' ')
  const avatarUrl = ctx.userAvatarUrls.get(mapped.id)
  // The picture lives on its owner's DC, and TDLib encodes that DC in the photo's
  // persistent file id; a person without a photo has no DC to show.
  const dcId = dcIdFromRemoteFileId(
    user.profile_photo?.small?.remote?.id ?? user.profile_photo?.big?.remote?.id,
  )
  return {
    userId: mapped.id,
    title: name || mapped.username || `用户 ${mapped.id}`,
    ...(mapped.username ? { username: mapped.username } : {}),
    ...(mapped.phone ? { phone: mapped.phone } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(dcId ? { dcId } : {}),
  }
}
