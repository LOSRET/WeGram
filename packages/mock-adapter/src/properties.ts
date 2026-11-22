import { AppError, type MessageProperties } from '@wegram/protocol'

import type { Fixture } from './constants'

export interface MockPropertyStore {
  fixtures: Map<number, Fixture>
}

/**
 * The fake `getMessageProperties` answer.
 *
 * The mock has no server-side edit window or protected content, so it mirrors the
 * rules the UI exercised before: only our own plain text is editable, only our own
 * message can be revoked, and everything else is allowed.
 */
export function mockMessageProperties(
  store: MockPropertyStore,
  input: { chatId: number; messageId: number },
): MessageProperties {
  const fixture = store.fixtures.get(input.chatId)
  const message = fixture?.messages.find((item) => item.id === input.messageId)
  if (!message) {
    throw new AppError('internal', `Unknown mock message ${input.chatId}/${input.messageId}`)
  }
  return {
    canBeEdited: message.outgoing && message.kind === 'text',
    canBeForwarded: true,
    canBeDeletedOnlyForSelf: true,
    canBeDeletedForAllUsers: message.outgoing,
    canBeCopied: message.text.length > 0,
    canBeReplied: true,
    // 转文字 is a voice-note feature, like TDLib's can_recognize_speech.
    canRecognizeSpeech: message.kind === 'voice',
    // The fake has no pin rights to model: every row can be pinned.
    canBePinned: true,
    // 举报 follows TDLib's `can_report_chat`: for users it needs a bot; basic
    // groups answer false; channels and supergroups answer true (the fake has no
    // creators to exclude, and its groups are supergroups).
    canReportChat: fixture !== undefined && fixture.chat.kind !== 'private',
  }
}
