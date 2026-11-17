import { describe, expect, it } from 'vitest'

import { isTranscriptRemoval } from './deletion'

/**
 * Regression guard for the empty-transcript bug: TDLib's cache trim must never
 * look like a user deletion (see the module comment for the measurement).
 */
describe('isTranscriptRemoval', () => {
  it('ignores a cache-only eviction, which the server can still answer', () => {
    expect(isTranscriptRemoval({ is_permanent: false, from_cache: true })).toBe(false)
    expect(isTranscriptRemoval({ from_cache: true })).toBe(false)
  })

  it('accepts a real deletion', () => {
    expect(isTranscriptRemoval({ is_permanent: true, from_cache: false })).toBe(true)
    expect(isTranscriptRemoval({ is_permanent: false, from_cache: false })).toBe(true)
  })

  it('accepts a deletion whose flags are missing', () => {
    expect(isTranscriptRemoval({})).toBe(true)
  })
})
