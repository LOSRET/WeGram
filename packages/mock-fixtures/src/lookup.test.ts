import type { ChatSummary } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import {
  botCommandsAnswer,
  botSeedByUsername,
  commonGroupIds,
  firstBotSeed,
  memberByUsername,
  seedByChatId,
  seedByUserId,
  seedByUsername,
} from './lookup'
import type { FixtureSeed } from './seed'

function chat(id: number, title: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return { id, title, kind: 'group', unread: 0, pinned: false, muted: false, ...overrides }
}

function seeds(): Map<number, FixtureSeed> {
  const map = new Map<number, FixtureSeed>()
  map.set(3, {
    chat: chat(3, '妈', { kind: 'private', userId: 37 }),
    messages: [],
    contact: { username: 'mama_wegram' },
    commonChatIds: [2, 4, 404],
  })
  map.set(13, {
    chat: chat(13, 'WeGram 助手', { kind: 'private', userId: 26 }),
    messages: [],
    bot: {
      username: 'wegram_helper',
      description: '你好，我是 WeGram 助手。',
      menu: { text: '打开小程序', url: 'https://w.test/app' },
      commands: [{ command: 'start', description: '开始' }],
    },
  })
  map.set(2, { chat: chat(2, '产品群'), messages: [] })
  map.set(4, { chat: chat(4, '频道', { kind: 'channel' }), messages: [] })
  return map
}

describe('seed lookups', () => {
  it('finds a row by chat id and by person id', () => {
    const index = seeds()
    expect(seedByChatId(index, 13)?.chat.title).toBe('WeGram 助手')
    expect(seedByChatId(index, 404)).toBeNull()
    expect(seedByUserId(index, 37)?.chat.id).toBe(3)
    expect(seedByUserId(index, 999)).toBeNull()
  })

  it('resolves a person or a bot by @handle, case-insensitively', () => {
    const index = seeds()
    expect(seedByUsername(index, ' @Mama_WeGram ')?.chat.userId).toBe(37)
    expect(seedByUsername(index, '@wegram_helper')?.chat.userId).toBe(26)
    expect(seedByUsername(index, 'nobody')).toBeNull()
    expect(seedByUsername(index, '')).toBeNull()
  })

  it('answers 添加成员 as id + title', () => {
    expect(memberByUsername(seeds(), '@wegram_helper')).toEqual({
      userId: 26,
      title: 'WeGram 助手',
    })
    expect(memberByUsername(seeds(), 'nobody')).toBeNull()
  })

  it('finds the bot that owns a handle, and the fixture bot', () => {
    const index = seeds()
    expect(botSeedByUsername(index, '@wegram_helper')?.chat.id).toBe(13)
    expect(botSeedByUsername(index, '@mama_wegram')).toBeNull()
    expect(firstBotSeed(index)?.chat.id).toBe(13)
    expect(firstBotSeed(new Map())).toBeNull()
  })

  it('projects bot commands, and no commands for anybody else', () => {
    const index = seeds()
    expect(botCommandsAnswer(index.get(13) ?? null)).toEqual({
      isBot: true,
      botUserId: 26,
      commands: [{ command: 'start', description: '开始' }],
      description: '你好，我是 WeGram 助手。',
      menu: { text: '打开小程序', url: 'https://w.test/app' },
    })
    expect(botCommandsAnswer(index.get(2) ?? null)).toEqual({ isBot: false, commands: [] })
  })

  it('lists only the shared groups that still exist', () => {
    expect(commonGroupIds(seeds(), 37)).toEqual([2])
    expect(commonGroupIds(seeds(), 999)).toEqual([])
  })
})
