import type { Message, MessageProperties } from '@wegram/protocol'

import { editLabel, editTargetOf } from '../../lib/editTarget'
import type { MenuItem } from '../ContextMenu'

export interface MessageMenuHandlers {
  onReply: (message: Message) => void
  onCopy: (message: Message) => void
  onForward: (message: Message) => void
  onEdit: (message: Message) => void
  onDelete: (message: Message, forBoth: boolean) => void
  onResend: (message: Message) => void
  /** 转文字: asks for the voice note's transcript (the text arrives as an op). */
  onTranscribe: (message: Message) => void
  /** 置顶消息 / 取消置顶 for this chat's one pinned message. */
  onTogglePin: (message: Message) => void
  /** 举报: report this one message to Telegram's moderators (a phased sheet). */
  onReport: (message: Message) => void
}

export interface MessageMenuOptions {
  /** A read-only conversation (a channel) has no composer to reply into. */
  canReply: boolean
  /**
   * TDLib's answer for this message, or null when the call failed: only the
   * items that need no capability are offered then.
   */
  properties: MessageProperties | null
  /** The chat's pinned message id, so this row's item reads 置顶 or 取消置顶. */
  pinnedMessageId?: number | null
}

/**
 * The transcript's right-click menu.
 *
 * 编辑/转发/撤回 are TDLib's booleans (`getMessageProperties`), not guesses from
 * `outgoing`/`kind`: the 48-hour edit window, protected content and the
 * delete-for-me vs delete-for-everyone split live in TDLib. The flag covers
 * three edit calls and this client implements two, so the row's kind decides
 * the label and the channel: 编辑 for text, 编辑说明 for a caption.
 */
export function buildMessageMenuItems(
  message: Message,
  handlers: MessageMenuHandlers,
  { canReply, properties, pinnedMessageId }: MessageMenuOptions,
): MenuItem[] {
  const items: MenuItem[] = []
  // 未发送 rows get 重试 first: it is the only action that can still deliver them.
  if (message.sendingState === 'failed' && message.canRetry !== false) {
    items.push({ label: '重试', onSelect: () => handlers.onResend(message) })
  }
  if (canReply && (properties === null || properties.canBeReplied)) {
    items.push({ label: '回复', onSelect: () => handlers.onReply(message) })
  }
  if (message.text.length > 0 && (properties === null || properties.canBeCopied)) {
    items.push({ label: '复制', onSelect: () => handlers.onCopy(message) })
  }
  // 转文字: voice notes only, and only where TDLib says speech is recognised
  // (an unpublished/limited trial answers a refusal instead of a transcript).
  if (message.kind === 'voice' && properties?.canRecognizeSpeech) {
    items.push({ label: '转文字', onSelect: () => handlers.onTranscribe(message) })
  }
  if (properties?.canBeForwarded) {
    items.push({ label: '转发', onSelect: () => handlers.onForward(message) })
  }
  // 编辑 / 编辑说明: the row's kind picks the call (`lib/editTarget.ts`), TDLib's
  // flag says whether it is allowed at all.
  const editTarget = properties?.canBeEdited ? editTargetOf(message) : null
  if (editTarget) {
    items.push({ label: editLabel(editTarget), onSelect: () => handlers.onEdit(message) })
  }
  // 置顶消息: Telegram keeps one per chat, and `can_be_pinned` is TDLib's answer
  // (pin rights, protected content). WeChat has no such bar — product decision.
  if (properties?.canBePinned) {
    items.push({
      label: pinnedMessageId === message.id ? '取消置顶' : '置顶',
      onSelect: () => handlers.onTogglePin(message),
    })
  }
  // 举报: TDLib's `can_report_chat` decides (moderator-reportable content, the
  // chat kind). The sheet files it against this chat with this message attached.
  if (properties?.canReportChat) {
    items.push({ label: '举报', danger: true, onSelect: () => handlers.onReport(message) })
  }
  if (properties?.canBeDeletedForAllUsers && message.outgoing) {
    items.push({ label: '撤回', onSelect: () => handlers.onDelete(message, true) })
  }
  if (
    properties === null ||
    properties.canBeDeletedOnlyForSelf ||
    properties.canBeDeletedForAllUsers
  ) {
    items.push({ label: '删除', danger: true, onSelect: () => handlers.onDelete(message, false) })
  }
  return items
}
