import type { Self } from '@wegram/protocol'

import type { TdObject } from '../client'

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
