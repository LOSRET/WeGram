import type { MessageEntity } from '@wegram/protocol'

/**
 * Finds the `@username` runs a plain string carries (design doc §8.3).
 *
 * A sticker set's title arrives as one flat string — TDLib keeps no entities for
 * it — yet the pack name is where an author advertises their account. That is why
 * the official client parses this one non-message surface: Telegram Desktop's
 * `StickerSetBox::title` runs `TextUtilities::ParseEntities` with
 * `TextParseMentions`, so "Deepseek Chan @zhxia_cn" opens the account behind the
 * name. The picker hands its title to `RichText` like a message body, and a tap
 * then resolves the name through `chats:openUsername` exactly as a mention in a
 * message does.
 *
 * Deliberately narrow: Telegram usernames are 5–32 characters of `A-Z a-z 0-9 _`,
 * and the `@` must not continue a word — `team@example.com` is an address, not a
 * mention, and a pack called "@all" has no single account to open.
 */
const USERNAME = /(?<![A-Za-z0-9_])@([A-Za-z0-9_]{5,32})(?![A-Za-z0-9_])/g

export function mentionEntitiesOf(text: string): MessageEntity[] {
  const entities: MessageEntity[] = []
  for (const match of text.matchAll(USERNAME)) {
    const name = match[1] ?? ''
    entities.push({ type: 'mention', offset: match.index ?? 0, length: name.length + 1 })
  }
  return entities
}
