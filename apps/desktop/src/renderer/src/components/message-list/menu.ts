import type { Message } from '@wegram/protocol'

import type { MenuItem } from '../ContextMenu'

export interface MessageMenuHandlers {
  onReply: (message: Message) => void
  onCopy: (message: Message) => void
  onForward: (message: Message) => void
  onEdit: (message: Message) => void
  onDelete: (message: Message) => void
}

export interface MessageMenuOptions {
  /** A read-only conversation (a channel) has no composer to reply into. */
  canReply: boolean
}

/**
 * The transcript's right-click menu. WeChat's order, with 编辑 only where it is
 * legal: our own plain text messages (media captions are edited elsewhere) and
 * 删除 marked as the dangerous row.
 */
export function buildMessageMenuItems(
  message: Message,
  handlers: MessageMenuHandlers,
  { canReply = true }: Partial<MessageMenuOptions> = {},
): MenuItem[] {
  const items: MenuItem[] = canReply
    ? [{ label: '回复', onSelect: () => handlers.onReply(message) }]
    : []
  if (message.text) items.push({ label: '复制', onSelect: () => handlers.onCopy(message) })
  items.push({ label: '转发', onSelect: () => handlers.onForward(message) })
  if (message.outgoing && message.kind === 'text') {
    items.push({ label: '编辑', onSelect: () => handlers.onEdit(message) })
  }
  items.push({ label: '删除', danger: true, onSelect: () => handlers.onDelete(message) })
  return items
}
