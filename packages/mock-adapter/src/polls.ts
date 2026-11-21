import type { InvokeRequest, Message } from '@wegram/protocol'
import { AppError } from '@wegram/protocol'

import type { AdapterEvent } from '@wegram/adapter-contract'
import { applyPollVote, type PollVoteRejection } from '@wegram/mock-session'

import type { Fixture } from './constants'

/**
 * Poll endpoints for the fake adapter (design doc §9.10).
 *
 * The vote arithmetic is the shared rule in @wegram/mock-session; this module
 * only finds the row, applies it and announces the refreshed message. Split out
 * of index.ts when the adapter class reached its line budget.
 */
export function createMockPolls(
  fixtures: Map<number, Fixture>,
  emit: (event: AdapterEvent) => void,
) {
  const requireMessage = (chatId: number, messageId: number): Message => {
    const fixture = fixtures.get(chatId)
    if (!fixture) throw new AppError('internal', `Unknown mock chat ${chatId}`)
    const message = fixture.messages.find((item) => item.id === messageId)
    if (!message) throw new AppError('internal', `Unknown mock message ${messageId}`)
    return message
  }

  const replacePoll = (
    chatId: number,
    message: Message,
    poll: NonNullable<Message['poll']>,
  ): void => {
    const fixture = fixtures.get(chatId)
    if (!fixture) throw new AppError('internal', `Unknown mock chat ${chatId}`)
    const updated: Message = { ...message, poll }
    fixture.messages = fixture.messages.map((item) => (item.id === updated.id ? updated : item))
    emit({ type: 'messages', chatId, ops: [{ op: 'replace', message: updated }] })
  }

  const votePoll = async (input: InvokeRequest<'messages:vote'>): Promise<void> => {
    const message = requireMessage(input.chatId, input.messageId)
    if (!message.poll) throw new AppError('invalid_payload', '这条消息不是投票')
    const poll = { ...message.poll, options: message.poll.options.map((option) => ({ ...option })) }
    const rejection = applyPollVote(poll, input.optionIds)
    if (rejection) throw rejectionError(rejection)
    replacePoll(input.chatId, message, poll)
  }

  const addPollOption = async (input: InvokeRequest<'messages:addPollOption'>): Promise<void> => {
    const message = requireMessage(input.chatId, input.messageId)
    if (!message.poll?.canAddOption || message.poll.closed) {
      throw new AppError('forbidden', '这个投票不能添加选项')
    }
    const text = input.text.trim()
    if (!text) throw new AppError('invalid_payload', '选项内容不能为空')
    const index = message.poll.options.length
    const poll = {
      ...message.poll,
      options: [
        ...message.poll.options,
        {
          index,
          id: `option-${message.id}-${index}`,
          text,
          voterCount: 0,
          votePercentage: 0,
          chosen: false,
        },
      ],
    }
    replacePoll(input.chatId, message, poll)
  }

  return { votePoll, addPollOption }
}

/** The fake's AppError for a vote the shared poll rules refused. */
function rejectionError(rejection: PollVoteRejection): AppError {
  switch (rejection) {
    case 'closed':
      return new AppError('forbidden', '投票已结束')
    case 'restricted':
      return new AppError('forbidden', '当前账号不能参与这个投票')
    case 'quiz-locked':
      return new AppError('forbidden', '这道题已经答过了')
    case 'single-answer':
      return new AppError('invalid_payload', '这个投票只能选一项')
    case 'invalid-option':
      return new AppError('invalid_payload', '选项不存在')
  }
}
