import { describe, expect, it } from 'vitest'

import type { Fixture } from './constants'
import { mockMessageProperties } from './properties'

function fixture(chatId: number, kind: Fixture['chat']['kind']): Fixture {
  return {
    chat: { id: chatId, title: `chat-${chatId}`, kind, unread: 0, pinned: false, muted: false },
    messages: [
      {
        id: chatId * 10,
        chatId,
        senderId: 7,
        senderName: '对方',
        outgoing: false,
        date: 1_700_000_000,
        kind: 'text',
        text: 'hello',
      },
    ],
  }
}

function store(seed: Fixture[]): { fixtures: Map<number, Fixture> } {
  return { fixtures: new Map(seed.map((item) => [item.chat.id, item])) }
}

describe('mockMessageProperties 举报 gate', () => {
  it("mirrors TDLib: a human's private chat cannot be reported from a message", () => {
    const props = mockMessageProperties(store([fixture(3, 'private')]), {
      chatId: 3,
      messageId: 30,
    })
    // `DialogManager::can_report_dialog` asks `can_report_user`, which wants a bot.
    expect(props.canReportChat).toBe(false)
  })

  it('allows a channel or supergroup, where TDLib answers true', () => {
    const channels = store([fixture(4, 'channel'), fixture(2, 'group')])
    expect(mockMessageProperties(channels, { chatId: 4, messageId: 40 }).canReportChat).toBe(true)
    expect(mockMessageProperties(channels, { chatId: 2, messageId: 20 }).canReportChat).toBe(true)
  })
})
