export interface SendKeyEvent {
  key: string
  shiftKey: boolean
  /**
   * `event.nativeEvent.isComposing`. Checked on top of the composition flag
   * because some IMEs report a still-active composition on the keydown that
   * ends it.
   */
  nativeComposing: boolean
}

/**
 * Is this keydown the "send" gesture? (design doc §8.4)
 *
 * Enter sends, Shift+Enter breaks the line, and nothing sends while an IME
 * composition is live — the Enter that commits a 拼音 candidate must not post
 * the half-typed message. Both composers read this one rule.
 */
export function shouldSend(event: SendKeyEvent, composing: boolean): boolean {
  if (event.key !== 'Enter' || event.shiftKey) return false
  return !composing && !event.nativeComposing
}
