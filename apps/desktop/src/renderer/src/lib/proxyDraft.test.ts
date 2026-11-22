import { describe, expect, it } from 'vitest'

import { describeProxy, draftFromConfig, EMPTY_DRAFT, proxyTypeLabel, toProxyConfig } from './proxyDraft'

/**
 * One round trip, because the editor and the panel disagreeing about what a field
 * means is how a proxy silently becomes 127.0.0.1:0.
 */
describe('toProxyConfig', () => {
  it('builds a SOCKS5 config', () => {
    expect(toProxyConfig({ ...EMPTY_DRAFT, host: ' 127.0.0.1 ', port: '7890' })).toEqual({
      type: 'socks5',
      host: '127.0.0.1',
      port: 7890,
    })
  })

  it('carries credentials only when they were typed', () => {
    expect(
      toProxyConfig({ ...EMPTY_DRAFT, type: 'http', host: 'p.example', port: '3128', username: 'u' }),
    ).toEqual({ type: 'http', host: 'p.example', port: 3128, username: 'u' })
  })

  it('builds an MTProxy config with its secret', () => {
    expect(
      toProxyConfig({ ...EMPTY_DRAFT, type: 'mtproto', host: 'p.example', port: '443', secret: 'dd01' }),
    ).toEqual({ type: 'mtproto', host: 'p.example', port: 443, secret: 'dd01' })
  })

  it('refuses what cannot be a proxy', () => {
    expect(toProxyConfig(EMPTY_DRAFT)).toBeNull()
    expect(toProxyConfig({ ...EMPTY_DRAFT, host: 'p.example', port: '0' })).toBeNull()
    expect(toProxyConfig({ ...EMPTY_DRAFT, host: 'p.example', port: '70000' })).toBeNull()
    expect(toProxyConfig({ ...EMPTY_DRAFT, host: 'p.example', port: '80a' })).toBeNull()
  })
})

describe('draftFromConfig', () => {
  it('round-trips a stored configuration', () => {
    const config = { type: 'socks5', host: '127.0.0.1', port: 7890, username: 'u', password: '***' } as const
    expect(toProxyConfig(draftFromConfig(config))).toEqual(config)
  })

  it('starts empty when nothing is stored', () => {
    expect(draftFromConfig(null)).toBe(EMPTY_DRAFT)
  })
})

describe('row labels', () => {
  it('names each type the way main logs it', () => {
    expect(proxyTypeLabel('socks5')).toBe('SOCKS5')
    expect(proxyTypeLabel('http')).toBe('HTTP')
    expect(proxyTypeLabel('mtproto')).toBe('MTProxy')
    expect(describeProxy({ type: 'http', host: '127.0.0.1', port: 7892 })).toBe('HTTP 127.0.0.1:7892')
  })
})
