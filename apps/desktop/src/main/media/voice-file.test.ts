import { describe, expect, it } from 'vitest'

import { VOICE_FILE_MAX_AGE_MS, staleVoiceFiles, voiceFilePath } from './voice-file'

describe('voice recording files', () => {
  const now = 1_800_000_000_000

  it('prunes only old OGG recordings', () => {
    const entries = [
      { name: 'voice-1-aaa.ogg', mtimeMs: now - VOICE_FILE_MAX_AGE_MS - 1 },
      { name: 'voice-2-bbb.ogg', mtimeMs: now - 60_000 },
      { name: 'notes.txt', mtimeMs: now - VOICE_FILE_MAX_AGE_MS * 10 },
    ]
    expect(staleVoiceFiles(entries, now)).toEqual(['voice-1-aaa.ogg'])
  })

  it('keeps a recording that is exactly at the limit', () => {
    expect(
      staleVoiceFiles([{ name: 'voice.ogg', mtimeMs: now - VOICE_FILE_MAX_AGE_MS }], now),
    ).toEqual([])
  })

  it('names every recording uniquely under the voice directory', () => {
    const first = voiceFilePath('C:\\voice', now)
    const second = voiceFilePath('C:\\voice', now)
    expect(first.startsWith('C:\\voice\\voice-')).toBe(true)
    expect(first.endsWith('.ogg')).toBe(true)
    expect(first).not.toBe(second)
  })
})
