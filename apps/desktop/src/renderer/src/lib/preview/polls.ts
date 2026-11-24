import {
  applyPollVote,
  copyPoll,
  newPollOption,
  pollOptionTarget,
  pollVoteRejection,
} from '@wegram/mock-session'
import type { InvokeChannel, Message } from '@wegram/protocol'

import type { PreviewMessagesStore } from './messages'

/**
 * Poll commands in the browser preview (design doc §9.10). The vote arithmetic,
 * the add-option row and the words a refusal carries are `@wegram/mock-session`'s;
 * this side only swaps the message and emits the replace op the renderer knows.
 */
export function handlePreviewPoll(
  channel: InvokeChannel,
  payload: { chatId?: unknown; messageId?: unknown; optionIds?: unknown; text?: unknown },
  store: PreviewMessagesStore,
): void {
  const chatId = Number(payload.chatId)
  const messageId = Number(payload.messageId)
  const list = store.messagesByChat[chatId] ?? []
  const message = list.find((item) => item.id === messageId)
  if (!message?.poll) throw { code: 'invalid_payload', message: '这条消息不是投票' }

  if (channel === 'messages:vote') {
    const optionIds = Array.isArray(payload.optionIds)
      ? payload.optionIds.map(Number).filter((id: number) => Number.isInteger(id))
      : []
    const poll = copyPoll(message.poll)
    const rejection = applyPollVote(poll, optionIds)
    if (rejection) throw pollVoteRejection(rejection)
    replace(store, chatId, list, { ...message, poll })
    return
  }

  const target = pollOptionTarget(message.poll, String(payload.text ?? ''))
  if ('rejection' in target) throw target.rejection
  replace(store, chatId, list, {
    ...message,
    poll: {
      ...target.poll,
      options: [
        ...target.poll.options,
        newPollOption(message.id, target.poll.options.length, target.text),
      ],
    },
  })
}

function replace(
  store: PreviewMessagesStore,
  chatId: number,
  list: Message[],
  message: Message,
): void {
  store.messagesByChat[chatId] = list.map((item) => (item.id === message.id ? message : item))
  store.emit('evt:messages', { chatId, ops: [{ op: 'replace', message }] })
}
