import type { Message } from '@wegram/protocol'
import { AppError } from '@wegram/protocol'

import type { AdapterEvent } from '@wegram/adapter-contract'
import type { Fixture } from './constants'

/**
 * The mock's message edits: a text row (编辑), a media caption (编辑说明), deletion
 * and 重试.
 *
 * Split out of `index.ts` when the adapter class reached its line budget: all
 * four rewrite one fixture row in place and announce the op that describes it, so
 * they belong together and away from the auth/transport surface.
 */
export function createMockEdits(
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

  const editText = async (input: {
    chatId: number
    messageId: number
    text: string
  }): Promise<Message> => {
    const target = requireMessage(input.chatId, input.messageId)
    target.text = input.text
    target.edited = true
    emit({
      type: 'messages',
      chatId: input.chatId,
      ops: [{ op: 'edit', chatId: input.chatId, messageId: input.messageId, text: input.text }],
    })
    return { ...target }
  }

  /**
   * 编辑说明: a caption *is* the media message's `text`, and the row's replacement
   * carries the whole message, so the edit announces a `replace` rather than a
   * text patch — the same op the real adapter's server answer produces.
   */
  const editCaption = async (input: {
    chatId: number
    messageId: number
    caption: string
  }): Promise<Message> => {
    const target = requireMessage(input.chatId, input.messageId)
    target.text = input.caption
    target.edited = true
    emit({
      type: 'messages',
      chatId: input.chatId,
      ops: [{ op: 'replace', message: { ...target } }],
    })
    return { ...target }
  }

  const deleteMessages = async (input: {
    chatId: number
    messageIds: number[]
    forBoth: boolean
  }): Promise<void> => {
    const fixture = fixtures.get(input.chatId)
    if (!fixture) throw new AppError('internal', `Unknown mock chat ${input.chatId}`)
    fixture.messages = fixture.messages.filter((m) => !input.messageIds.includes(m.id))
    emit({
      type: 'messages',
      chatId: input.chatId,
      ops: [{ op: 'delete', chatId: input.chatId, messageIds: input.messageIds }],
    })
  }

  /**
   * 重试 a failed fixture message. The failed row stays in the transcript (TDLib
   * keeps those too); resending clears its state and announces the replacement.
   */
  const resendMessages = async (chatId: number, messageIds: number[]): Promise<void> => {
    const fixture = fixtures.get(chatId)
    if (!fixture) throw new AppError('internal', `Unknown mock chat ${chatId}`)
    for (const id of messageIds) {
      const message = fixture.messages.find((item) => item.id === id)
      if (!message) continue
      delete message.sendingState
      delete message.sendError
      delete message.canRetry
      emit({
        type: 'messages',
        chatId,
        ops: [{ op: 'replace', message: { ...message } }],
      })
    }
  }

  return { editText, editCaption, deleteMessages, resendMessages }
}
