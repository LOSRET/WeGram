import type { SendKey } from '@wegram/protocol'

export interface SendKeyEvent {
  key: string
  shiftKey: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  /**
   * `event.nativeEvent.isComposing`. Checked on top of the composition flag
   * because some IMEs report a still-active composition on the keydown that
   * ends it.
   */
  nativeComposing: boolean
}

/**
 * Is this keydown the "send" gesture? (design doc §8.4, §9.11.3)
 *
 * Enter sends, Shift+Enter breaks the line, and nothing sends while an IME
 * composition is live — the Enter that commits a 拼音 candidate must not post
 * the half-typed message. 通用 → 发送消息 can switch the rule to Ctrl+Enter (the
 * Windows habit): a bare Enter then breaks the line and Ctrl/⌘+Enter sends.
 *
 * Both composers read this one rule.
 */
export function shouldSend(
  event: SendKeyEvent,
  composing: boolean,
  sendKey: SendKey = 'enter',
): boolean {
  if (event.key !== 'Enter' || event.shiftKey) return false
  if (composing || event.nativeComposing) return false
  if (sendKey === 'ctrlEnter') return event.ctrlKey === true || event.metaKey === true
  return true
}
