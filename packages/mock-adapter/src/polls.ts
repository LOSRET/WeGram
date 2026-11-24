import {
  applyPollVote,
  copyPoll,
  newPollOption,
  pollOptionTarget,
  pollVoteRejection,
} from '@wegram/mock-session'
import { AppError } from '@wegram/protocol'
import type { InvokeRequest, Message } from '@wegram/protocol'

import type { AdapterEvent } from '@wegram/adapter-contract'

import type { Fixture } from './constants'

/**
 * Poll endpoints for the fake adapter (design doc §9.10).
 *
 * The vote arithmetic, the add-option row and the words a refusal carries are
 * `@wegram/mock-session`'s — the browser preview serves the same answers, so the
 * two fakes cannot drift. This module only finds the row, writes the copy and
 * announces the refreshed message.
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
    const poll = copyPoll(message.poll)
    const rejection = applyPollVote(poll, input.optionIds)
    if (rejection) {
      const refusal = pollVoteRejection(rejection)
      throw new AppError(refusal.code, refusal.message)
    }
    replacePoll(input.chatId, message, poll)
  }

  const addPollOption = async (
    input: InvokeRequest<'messages:addPollOption'>,
  ): Promise<void> => {
    const message = requireMessage(input.chatId, input.messageId)
    const target = pollOptionTarget(message.poll, input.text)
    if ('rejection' in target) {
      throw new AppError(target.rejection.code, target.rejection.message)
    }
    const poll = {
      ...target.poll,
      options: [
        ...target.poll.options,
        newPollOption(input.messageId, target.poll.options.length, target.text),
      ],
    }
    replacePoll(input.chatId, message, poll)
  }

  const refreshPoll = async (input: InvokeRequest<'messages:refreshPoll'>): Promise<boolean> => {
    const message = requireMessage(input.chatId, input.messageId)
    return message.poll !== undefined
  }

  return { votePoll, addPollOption, refreshPoll }
}
