import { describe, expect, it } from 'vitest'

import { botStartText } from './botStart'

describe('botStartText', () => {
  it('starts a bot without arguments when no deep link supplied one', () => {
    expect(botStartText()).toBe('/start')
    expect(botStartText('')).toBe('/start')
  })

  it('keeps the deep-link payload on the same command', () => {
    expect(botStartText('invite_abc-123')).toBe('/start invite_abc-123')
  })
})
