import type { ChatSummary } from '@wegram/protocol'

/** Chinese label for a conversation kind. */
export function kindLabel(kind: ChatSummary['kind']): string {
  if (kind === 'group') return '群聊'
  if (kind === 'channel') return '频道'
  return '私聊'
}
