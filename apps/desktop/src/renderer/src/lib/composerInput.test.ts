import { describe, expect, it } from 'vitest'

import { shouldSend } from './composerInput'

const enter = (overrides: Partial<Parameters<typeof shouldSend>[0]> = {}) => ({
  key: 'Enter',
  shiftKey: false,
  nativeComposing: false,
  ...overrides,
})

describe('shouldSend', () => {
  it('sends on a plain Enter', () => {
    expect(shouldSend(enter(), false)).toBe(true)
  })

  it('keeps Shift+Enter as a newline', () => {
    expect(shouldSend(enter({ shiftKey: true }), false)).toBe(false)
  })

  it('ignores other keys', () => {
    expect(shouldSend(enter({ key: 'a' }), false)).toBe(false)
    expect(shouldSend(enter({ key: 'Escape' }), false)).toBe(false)
  })

  it('sends on Ctrl/⌘+Enter when 发送消息 is Ctrl+Enter', () => {
    expect(shouldSend(enter({ ctrlKey: true }), false, 'ctrlEnter')).toBe(true)
    expect(shouldSend(enter({ metaKey: true }), false, 'ctrlEnter')).toBe(true)
  })

  it('keeps a bare Enter as a newline when 发送消息 is Ctrl+Enter', () => {
    expect(shouldSend(enter(), false, 'ctrlEnter')).toBe(false)
  })

  it('never sends while a composition is live', () => {
    expect(shouldSend(enter(), true)).toBe(false)
    expect(shouldSend(enter({ nativeComposing: true }), false)).toBe(false)
  })
})
