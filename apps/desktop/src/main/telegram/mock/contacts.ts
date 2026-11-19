import type { Contact } from '@wegram/protocol'

import { ME, type Fixture } from './constants'

/**
 * The mock address book: every private fixture that is a person rather than our
 * own Saved Messages conversation.
 *
 * The real adapter reads the same fields from TDLib's `getContacts` + `getUser`;
 * keeping the rule here means the mock's list cannot drift from its fixtures
 * without a test noticing.
 */
export function listMockContacts(fixtures: Map<number, Fixture>): Contact[] {
  const contacts: Contact[] = []
  for (const fixture of fixtures.values()) {
    const { chat, contact } = fixture
    if (chat.kind !== 'private' || chat.userId === undefined || chat.userId === ME.id) continue
    contacts.push({
      userId: chat.userId,
      title: chat.title,
      ...(contact?.username ? { username: contact.username } : {}),
      ...(contact?.phone ? { phone: contact.phone } : {}),
      ...(chat.avatarUrl ? { avatarUrl: chat.avatarUrl } : {}),
    })
  }
  return contacts.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
}
