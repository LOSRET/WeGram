import type { BotCommandsAnswer } from '@wegram/protocol'

import type { FixtureSeed } from './seed'

/**
 * Lookups over the fake account, shared by the two fakes.
 *
 * Both the mock adapter and the browser preview resolve the same things out of
 * the same dataset — a person by id, an @username to a chat member, the bot that
 * owns a handle, the groups two people share — and each had grown its own loop
 * over the seeds. These are those loops, once. A caller passes its own map (both
 * fakes key the seed by chat id) and gets the same row back.
 */

/** The seed map both fakes hold (`@wegram/mock-fixtures` builds it). */
export type SeedIndex = ReadonlyMap<number, FixtureSeed>

/** The seed behind one chat id. */
export function seedByChatId(seeds: SeedIndex, chatId: number): FixtureSeed | null {
  return seeds.get(chatId) ?? null
}

/** The seed behind a person id (a private chat's `chat.userId`). */
export function seedByUserId(seeds: SeedIndex, userId: number): FixtureSeed | null {
  for (const seed of seeds.values()) {
    if (seed.chat.userId === userId) return seed
  }
  return null
}

/**
 * The private seed behind an @username: a person's `contact.username` or a bot's
 * own handle. A group or channel username is not an address a fake client opens.
 */
export function seedByUsername(seeds: SeedIndex, input: string): FixtureSeed | null {
  const handle = input.trim().replace(/^@+/, '').toLowerCase()
  if (!handle) return null
  for (const seed of seeds.values()) {
    if (seed.chat.kind !== 'private' || !seed.chat.userId) continue
    if (seed.contact?.username?.toLowerCase() === handle) return seed
    if (seed.bot?.username?.toLowerCase() === handle) return seed
  }
  return null
}

/** 添加成员: who an @username names, as `addChatMembers` answers. */
export function memberByUsername(
  seeds: SeedIndex,
  input: string,
): { userId: number; title: string } | null {
  const seed = seedByUsername(seeds, input)
  const userId = seed?.chat.userId
  return seed && userId ? { userId, title: seed.chat.title } : null
}

/** The bot that owns an @username (`@bot query` addresses a bot by handle). */
export function botSeedByUsername(seeds: SeedIndex, input: string): FixtureSeed | null {
  const handle = input.trim().replace(/^@+/, '').toLowerCase()
  if (!handle) return null
  for (const seed of seeds.values()) {
    if (seed.bot?.username?.toLowerCase() === handle) return seed
  }
  return null
}

/** The fixture's bot, for the composer's `/` handle (the account has one). */
export function firstBotSeed(seeds: SeedIndex): FixtureSeed | null {
  for (const seed of seeds.values()) {
    if (seed.bot) return seed
  }
  return null
}

/**
 * `bots:commands` for one chat: the fixture bot publishes its list, anything else
 * answers "no commands", exactly like TDLib does for a human chat.
 */
export function botCommandsAnswer(seed: FixtureSeed | null): BotCommandsAnswer {
  return seed?.bot
    ? { isBot: true, commands: seed.bot.commands, description: seed.bot.description ?? '' }
    : { isBot: false, commands: [] }
}

/**
 * 共同群聊: the group chats this person shares with the account. Ids, not rows, so
 * each fake maps them to its own chat objects (the preview decorates its rows with
 * generated photos, the mock already has real ones).
 */
export function commonGroupIds(seeds: SeedIndex, userId: number): number[] {
  const person = seedByUserId(seeds, userId)
  return (person?.commonChatIds ?? []).filter((id) => seeds.get(id)?.chat.kind === 'group')
}
