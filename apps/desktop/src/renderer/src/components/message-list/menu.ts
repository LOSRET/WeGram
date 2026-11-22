import type { Message, MessageProperties } from '@wegram/protocol'

import type { MenuItem } from '../ContextMenu'

export interface MessageMenuHandlers {
  onReply: (message: Message) => void
  onCopy: (message: Message) => void
  onForward: (message: Message) => void
  onEdit: (message: Message) => void
  onDelete: (message: Message, forBoth: boolean) => void
  onResend: (message: Message) => void
}

export interface MessageMenuOptions {
  /** A read-only conversation (a channel) has no composer to reply into. */
  canReply: boolean
  /**
   * TDLib's answer for this message, or null when the call failed: only the
   * items that need no capability are offered then.
   */
  properties: MessageProperties | null
}

/**
 * The transcript's right-click menu.
 *
 * 编辑/转发/撤回 are TDLib's booleans (`getMessageProperties`), not guesses from
 * `outgoing`/`kind`: the 48-hour edit window, protected content and the
 * delete-for-me vs delete-for-everyone split live in TDLib. 编辑 still needs a
 * plain text row, because this client only implements `editMessageText`; a
 * caption's `can_be_edited` waits for `editMessageCaption`.
 */
export function buildMessageMenuItems(
  message: Message,
  handlers: MessageMenuHandlers,
  { canReply, properties }: MessageMenuOptions,
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
  if (properties?.canBeForwarded) {
    items.push({ label: '转发', onSelect: () => handlers.onForward(message) })
  }
  if (properties?.canBeEdited && message.kind === 'text') {
    items.push({ label: '编辑', onSelect: () => handlers.onEdit(message) })
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
