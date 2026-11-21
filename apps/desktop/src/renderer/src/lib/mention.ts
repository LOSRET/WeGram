import type { EntityAttributes } from './entities'

/**
 * Where an @mention in a message leads (design doc §8.3).
 *
 * `mentionName` already names the user by id, while `mention` is the literal
 * `@username` that has to be resolved (`chats:openUsername`) when the reader
 * taps it. The parsed target is what `openMention` opens; nothing here talks to
 * IPC, so the rule stays unit-testable.
 */
export type MentionTarget =
  { kind: 'user'; userId: number } | { kind: 'username'; username: string }

/** Telegram usernames: ASCII letters, digits and underscores, behind one @. */
const USERNAME = /^@([A-Za-z0-9_]+)$/

/**
 * Resolves the words one mention entity covers.
 *
 * Returns `null` when the entity is not a mention, its id is unusable, or the
 * name is `@all` — that one names every member of a group, so there is no single
 * conversation to jump to and the text stays a plain coloured word.
 */
export function mentionTarget(
  text: string,
  entity: Pick<EntityAttributes, 'type' | 'userId'>,
): MentionTarget | null {
  if (entity.type === 'mentionName') {
    const userId = entity.userId
    return userId !== undefined && Number.isSafeInteger(userId) && userId > 0
      ? { kind: 'user', userId }
      : null
  }
  if (entity.type !== 'mention') return null
  const username = USERNAME.exec(text.trim())?.[1]
  if (!username || username.toLowerCase() === 'all') return null
  return { kind: 'username', username }
}

/**
 * Whether the mention names the signed-in account. Tapping it would otherwise
 * open 文件传输助手 (TDLib's private chat with oneself), which reads as a bug.
 */
export function isSelfMention(
  target: MentionTarget,
  self: { id: number; username?: string | undefined },
): boolean {
  if (target.kind === 'user') return target.userId === self.id
  return (
    self.username !== undefined && target.username.toLowerCase() === self.username.toLowerCase()
  )
}
