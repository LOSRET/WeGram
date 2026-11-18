import { describe, expect, it } from 'vitest'

import { parseApiCredentials } from './credentials'

/**
 * The inlined value decides whether a released installer can reach Telegram at all,
 * and a wrong answer is invisible until someone launches it (see
 * docs/HANDOFF.md → Release packaging). The shapes are pinned.
 */
describe('parseApiCredentials', () => {
  it('treats an empty or blank inline value as "no credentials"', () => {
    expect(parseApiCredentials('')).toBeNull()
    expect(parseApiCredentials('   ')).toBeNull()
  })

  it('parses the value electron.vite.config.ts inlines', () => {
    expect(
      parseApiCredentials('{"apiId":6123456,"apiHash":"0123456789abcdef0123456789abcdef"}'),
    ).toEqual({
      apiId: 6123456,
      apiHash: '0123456789abcdef0123456789abcdef',
    })
  })

  it('rejects malformed JSON instead of throwing during bootstrap', () => {
    expect(parseApiCredentials('{')).toBeNull()
    expect(parseApiCredentials('null')).toBeNull()
    expect(parseApiCredentials('"text"')).toBeNull()
  })

  it('rejects a missing, non-integer or non-positive apiId', () => {
    expect(parseApiCredentials('{"apiHash":"abc"}')).toBeNull()
    expect(parseApiCredentials('{"apiId":"6123456","apiHash":"abc"}')).toBeNull()
    expect(parseApiCredentials('{"apiId":1.5,"apiHash":"abc"}')).toBeNull()
    expect(parseApiCredentials('{"apiId":0,"apiHash":"abc"}')).toBeNull()
  })

  it('rejects an empty or missing apiHash', () => {
    expect(parseApiCredentials('{"apiId":6123456,"apiHash":""}')).toBeNull()
    expect(parseApiCredentials('{"apiId":6123456,"apiHash":42}')).toBeNull()
    expect(parseApiCredentials('{"apiId":6123456}')).toBeNull()
  })
})
