import { describe, expect, it } from 'vitest'

import { TYPING_REFRESH_MS, TypingPing } from './typingPing'

function harness() {
  let clock = 1_000
  const sent: boolean[] = []
  const ping = new TypingPing((typing) => sent.push(typing), () => clock)
  return {
    ping,
    sent,
    advance(ms: number): void {
      clock += ms
    },
  }
}

describe('TypingPing', () => {
  it('sends one ping for a burst of keystrokes', () => {
    const h = harness()
    h.ping.typing()
    h.ping.typing()
    h.ping.typing()
    expect(h.sent).toEqual([true])
  })

  it('refreshes once the peer-facing expiry has passed', () => {
    const h = harness()
    h.ping.typing()
    h.advance(TYPING_REFRESH_MS - 1)
    h.ping.typing()
    expect(h.sent).toEqual([true])
    h.advance(1)
    h.ping.typing()
    expect(h.sent).toEqual([true, true])
  })

  it('stops with a cancel, and stopping twice cancels once', () => {
    const h = harness()
    h.ping.typing()
    h.ping.stop()
    h.ping.stop()
    expect(h.sent).toEqual([true, false])
    // After a stop the next keystroke is a fresh ping, not a throttled no-op.
    h.ping.typing()
    expect(h.sent).toEqual([true, false, true])
  })

  it('does not cancel when nothing was announced', () => {
    const h = harness()
    h.ping.stop()
    expect(h.sent).toEqual([])
  })
})
