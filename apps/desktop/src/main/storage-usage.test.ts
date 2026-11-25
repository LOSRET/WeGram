import { cacheLimitSchema } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { cacheLimitBytes } from './storage-usage'

describe('cacheLimitBytes', () => {
  it('maps every 缓存上限 step to a ceiling, with 不限制 standing for none', () => {
    expect(cacheLimitBytes('unlimited')).toBeNull()
    expect(cacheLimitBytes('512mb')).toBe(512 * 1024 * 1024)
    expect(cacheLimitBytes('1gb')).toBe(1024 * 1024 * 1024)
    expect(cacheLimitBytes('2gb')).toBe(2048 * 1024 * 1024)
    expect(cacheLimitBytes('5gb')).toBe(5120 * 1024 * 1024)
    // A step added to the protocol without a byte mapping would be a setting that
    // silently trims nothing.
    for (const step of cacheLimitSchema.options) expect(cacheLimitBytes(step)).not.toBeUndefined()
  })
})
