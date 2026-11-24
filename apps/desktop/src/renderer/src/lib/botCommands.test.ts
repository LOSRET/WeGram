import { describe, expect, it } from 'vitest'

import type { BotCommand } from '@wegram/protocol'

import { commandQuery, commandText, filterCommands } from './botCommands'

const START: BotCommand = { command: 'start', description: '重新开始' }
const COMMANDS: BotCommand[] = [
  START,
  { command: 'settings', description: '设置提醒' },
  { command: 'help', description: '看看我能做什么' },
]

describe('commandQuery', () => {
  it('opens only for a slash at the very start of the box', () => {
    expect(commandQuery('/')).toBe('')
    expect(commandQuery('/se')).toBe('se')
    expect(commandQuery('/settings now')).toBeNull()
  })

  it('leaves prose and other text alone', () => {
    expect(commandQuery('')).toBeNull()
    expect(commandQuery('hi /start')).toBeNull()
    expect(commandQuery(' /start')).toBeNull()
  })
})

describe('filterCommands', () => {
  it('returns every command for an empty fragment', () => {
    expect(filterCommands(COMMANDS, '')).toEqual(COMMANDS)
  })

  it('puts name prefixes before description hits', () => {
    expect(filterCommands(COMMANDS, 'se').map((command) => command.command)).toEqual(['settings'])
    // "提醒" is only in a description, and still finds its command.
    expect(filterCommands(COMMANDS, '提醒').map((command) => command.command)).toEqual(['settings'])
  })

  it('is case-insensitive and answers an empty list for no match', () => {
    expect(filterCommands(COMMANDS, 'ST').map((command) => command.command)).toEqual(['start'])
    expect(filterCommands(COMMANDS, 'zzz')).toEqual([])
  })
})

describe('commandText', () => {
  it('leaves the command with a trailing space, ready for arguments', () => {
    expect(commandText(START)).toBe('/start ')
  })
})
