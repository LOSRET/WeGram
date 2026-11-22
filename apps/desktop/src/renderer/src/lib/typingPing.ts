/**
 * 对方正在输入: the renderer's side of the typing ping.
 *
 * TDLib's `sendChatAction` is a one-shot: the peer's client shows "typing" for a
 * few seconds and then forgets it. A message-per-keystroke is both wasteful and
 * wrong (the action would expire mid-sentence), so this sends one ping and then at
 * most one refresh per `TYPING_REFRESH_MS` while the reader keeps typing. Stopping
 * (`stop`) sends the cancel action, which is what makes the indicator disappear
 * the moment the box empties, the message is sent or the field loses focus.
 *
 * Pure by design: the clock and the sender are injected, so the throttle is
 * testable without a renderer (`typingPing.test.ts`).
 */
export const TYPING_REFRESH_MS = 3_500

export type TypingSender = (typing: boolean) => void

export class TypingPing {
  private active = false
  private lastSentAt = 0

  constructor(
    private readonly send: TypingSender,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The reader typed something. Ignored inside the refresh window. */
  typing(): void {
    const at = this.now()
    if (this.active && at - this.lastSentAt < TYPING_REFRESH_MS) return
    this.active = true
    this.lastSentAt = at
    this.send(true)
  }

  /** The box emptied, the message was sent, or the field lost focus. */
  stop(): void {
    if (!this.active) return
    this.active = false
    this.lastSentAt = 0
    this.send(false)
  }
}
