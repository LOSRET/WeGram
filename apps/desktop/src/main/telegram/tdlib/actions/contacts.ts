import type { Contact } from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import { mapContact } from '../map/contact'
import type { ActionDeps } from './deps'

/**
 * The account's Telegram address book.
 *
 * `getContacts` answers only user ids (TDLib keeps the contacts themselves as
 * `user` objects in its cache), so each one is resolved with `getUser`. A
 * deleted or otherwise unreachable user is skipped instead of failing the whole
 * address book: one stale entry must not empty the 通讯录.
 *
 * Photos are queued in the background like the chat list's: the rows draw
 * initials and gain their faces through `evt:avatars`.
 */
export async function listContacts(deps: ActionDeps): Promise<Contact[]> {
  const response = await deps.invoke({ _: 'getContacts' })
  const ids: number[] = asArray<number>(response?.user_ids)

  const users = await Promise.all(
    ids.map(async (userId) => {
      try {
        return (await deps.invoke({ _: 'getUser', user_id: userId })) as TdObject | undefined
      } catch (error) {
        deps.logger.warn(
          `contact ${userId} could not be resolved: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return undefined
      }
    }),
  )

  const contacts: Contact[] = []
  for (const user of users) {
    if (user) contacts.push(mapContact(deps.mapper, user))
  }
  deps.mapper.prefetchUserAvatars(contacts.map((contact) => contact.userId))
  return contacts
}
