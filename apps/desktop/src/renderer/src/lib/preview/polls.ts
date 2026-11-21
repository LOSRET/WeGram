import type { InvokeChannel, Message } from '@wegram/protocol'
import { applyPollVote } from '@wegram/mock-session'

import type { PreviewMessagesStore } from './messages'

/**
 * Poll commands in the browser preview (design doc §9.10). The vote arithmetic
 * is the same rule the mock adapter uses; this side only swaps the message and
 * emits the replace op the renderer already knows.
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
    const poll = { ...message.poll, options: message.poll.options.map((option) => ({ ...option })) }
    const rejection = applyPollVote(poll, optionIds)
    if (rejection) throw { code: 'forbidden', message: rejectionText(rejection) }
    replace(store, chatId, list, { ...message, poll })
    return
  }

  if (!message.poll.canAddOption || message.poll.closed) {
    throw { code: 'forbidden', message: '这个投票不能添加选项' }
  }
  const text = String(payload.text ?? '').trim()
  if (!text) throw { code: 'invalid_payload', message: '选项内容不能为空' }
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
  replace(store, chatId, list, { ...message, poll })
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

function rejectionText(reason: string): string {
  switch (reason) {
    case 'closed':
      return '投票已结束'
    case 'restricted':
      return '当前账号不能参与这个投票'
    case 'quiz-locked':
      return '这道题已经答过了'
    case 'single-answer':
      return '这个投票只能选一项'
    default:
      return '选项不存在'
  }
}
