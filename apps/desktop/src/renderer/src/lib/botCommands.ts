import type { BotCommand } from '@wegram/protocol'

/**
 * The composer's "/" command list (design doc §8.3): which box content opens it,
 * and which commands it shows.
 *
 * A command is only a command at the very start of the box and before the first
 * space — "/" in the middle of a sentence is punctuation, not a request for the
 * bot's menu. Pure and unit-tested: the popup's state is derived here, not in the
 * component.
 */
const TRIGGER = /^\/(\S*)$/

/** The fragment after "/", or null when the box is not typing a command. */
export function commandQuery(text: string): string | null {
  return TRIGGER.exec(text)?.[1] ?? null
}

/**
 * The commands the list draws for a fragment. Name matches come first (a prefix
 * beats an accidental hit in a description), then description matches, so typing
 * "se" surfaces `/settings` above a command that merely mentions "settings".
 */
export function filterCommands(commands: BotCommand[], query: string): BotCommand[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return commands
  const prefix = commands.filter((command) => command.command.toLowerCase().startsWith(needle))
  const rest = commands.filter(
    (command) => !prefix.includes(command) && command.description.toLowerCase().includes(needle),
  )
  return [...prefix, ...rest]
}

/** What picking a command leaves in the box: Telegram's own trailing space. */
export function commandText(command: BotCommand): string {
  return `/${command.command} `
}
