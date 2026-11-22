import { describe, expect, it } from 'vitest'

import { voiceBubbleWidth, voiceSecondsLabel } from './voiceBubble'

describe('voice bubble', () => {
  it('grows with the clip and stops growing past a minute', () => {
    expect(voiceBubbleWidth(1)).toBe(76)
    expect(voiceBubbleWidth(30)).toBe(137)
    expect(voiceBubbleWidth(60)).toBe(200)
    expect(voiceBubbleWidth(600)).toBe(200)
  })

  it('never shrinks below one second', () => {
    expect(voiceBubbleWidth(0)).toBe(76)
    expect(voiceBubbleWidth(undefined)).toBe(76)
  })

  it('prints seconds with the double-prime', () => {
    expect(voiceSecondsLabel(13)).toBe('13"')
    expect(voiceSecondsLabel(0)).toBe('0"')
    expect(voiceSecondsLabel(undefined)).toBe('0"')
  })
})
