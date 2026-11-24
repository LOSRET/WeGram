import { AppError, CAPTION_MESSAGE_KINDS, type MessageProperties } from '@wegram/protocol'

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
    // The same rows the renderer's `lib/editTarget.ts` offers 编辑/编辑说明 on: plain
    // text and a media row whose content is a caption. (This used to allow text
    // only, so a photo with a caption was not editable against the mock.)
    canBeEdited:
      message.outgoing &&
      (message.kind === 'text' || (CAPTION_MESSAGE_KINDS.has(message.kind) && Boolean(message.media))),
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
