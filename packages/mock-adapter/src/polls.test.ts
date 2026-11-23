import type { AdapterEvent } from '@wegram/adapter-contract'
import type { ChatSummary, Message } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import type { Fixture } from './constants'
import { createMockPolls } from './polls'

const CHAT: ChatSummary = {
  id: 1,
  title: 'poll chat',
  kind: 'group',
  unread: 0,
  pinned: false,
  muted: false,
}

function pollMessage(): Message {
  return {
    id: 10,
    chatId: 1,
    senderId: 7,
    senderName: '成员',
    outgoing: false,
    date: 1_760_000_000,
    kind: 'poll',
    text: 'where?',
    poll: {
      id: 'p1',
      question: 'where?',
      options: [
        { index: 0, text: 'a', voterCount: 0, votePercentage: 0, chosen: false },
        { index: 1, text: 'b', voterCount: 0, votePercentage: 0, chosen: false },
      ],
      totalVoterCount: 0,
      anonymous: false,
      allowsMultipleAnswers: false,
      canSeeResults: false,
      quiz: false,
      closed: false,
      canAddOption: true,
      answered: false,
    },
  }
}

function setup(): { fixture: Fixture; events: AdapterEvent[] } {
  const fixture: Fixture = { chat: { ...CHAT }, messages: [pollMessage()] }
  const events: AdapterEvent[] = []
  return { fixture, events }
}

describe('mock polls', () => {
  it('votes, then announces the replaced message', async () => {
    const { fixture, events } = setup()
    const polls = createMockPolls(new Map([[1, fixture]]), (event) => events.push(event))
    await polls.votePoll({ chatId: 1, messageId: 10, optionIds: [1] })
    const event = events.at(-1)
    if (event?.type !== 'messages') throw new Error('no message event')
    const op = event.ops.find((item) => item.op === 'replace')
    if (op?.op !== 'replace') throw new Error('not a replace')
    expect(op.message.poll?.options.map((option) => option.chosen)).toEqual([false, true])
    expect(op.message.poll?.totalVoterCount).toBe(1)
    expect(op.message.poll?.canSeeResults).toBe(true)
    expect(fixture.messages[0]).toBe(op.message)
  })

  it('adds an option when the poll allows it', async () => {
    const { fixture, events } = setup()
    const polls = createMockPolls(new Map([[1, fixture]]), (event) => events.push(event))
    await polls.addPollOption({ chatId: 1, messageId: 10, text: '  c  ' })
    const poll = fixture.messages[0]?.poll
    expect(poll?.options).toHaveLength(3)
    expect(poll?.options[2]).toMatchObject({ index: 2, text: 'c', voterCount: 0 })
    expect(events.some((event) => event.type === 'messages')).toBe(true)
  })

  it('refuses a new option on a closed poll', async () => {
    const { fixture } = setup()
    const message = fixture.messages[0]
    if (!message?.poll) throw new Error('missing poll')
    message.poll.closed = true
    const polls = createMockPolls(new Map([[1, fixture]]), () => {})
    await expect(
      polls.addPollOption({ chatId: 1, messageId: 10, text: 'late' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a vote on a closed poll', async () => {
    const { fixture } = setup()
    const message = fixture.messages[0]
    if (!message?.poll) throw new Error('missing poll')
    message.poll.closed = true
    const polls = createMockPolls(new Map([[1, fixture]]), () => {})
    await expect(
      polls.votePoll({ chatId: 1, messageId: 10, optionIds: [0] }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('reports an already answered quiz as poll_answered, not forbidden', async () => {
    const { fixture } = setup()
    const message = fixture.messages[0]
    if (!message?.poll) throw new Error('missing poll')
    message.poll.quiz = true
    message.poll.answered = true
    message.poll.options[0]!.chosen = true
    const polls = createMockPolls(new Map([[1, fixture]]), () => {})
    await expect(
      polls.votePoll({ chatId: 1, messageId: 10, optionIds: [1] }),
    ).rejects.toMatchObject({ code: 'poll_answered' })
  })

  it('refuses a row that is not a poll', async () => {
    const fixture: Fixture = {
      chat: { ...CHAT },
      messages: [{ ...pollMessage(), id: 11, kind: 'text', text: 'hi', poll: undefined }],
    }
    const polls = createMockPolls(new Map([[1, fixture]]), () => {})
    await expect(
      polls.votePoll({ chatId: 1, messageId: 11, optionIds: [0] }),
    ).rejects.toMatchObject({ code: 'invalid_payload' })
  })
})
