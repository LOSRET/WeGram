import { describe, expect, it } from 'vitest'

import { parseProxyUrl } from './proxy-url'

/**
 * The proxy URL is how the real-account launcher and `tdlib:smoke` configure the
 * tunnel. A parsing regression here looks like "TDLib hangs", which is the most
 * expensive bug class in this project (see docs/HANDOFF.md), so the shapes are
 * pinned.
 */
describe('parseProxyUrl', () => {
  it('returns null for an absent or blank value', () => {
    expect(parseProxyUrl(undefined)).toBeNull()
    expect(parseProxyUrl(null)).toBeNull()
    expect(parseProxyUrl('   ')).toBeNull()
  })

  it('parses a plain SOCKS5 URL', () => {
    expect(parseProxyUrl('socks5://127.0.0.1:7890')).toEqual({
      type: 'socks5',
      host: '127.0.0.1',
      port: 7890,
    })
  })

  it('unbrackets an IPv6 SOCKS5 literal (TDLib wants the bare address)', () => {
    expect(parseProxyUrl('socks5://[::1]:1080')).toEqual({
      type: 'socks5',
      host: '::1',
      port: 1080,
    })
    expect(parseProxyUrl('socks5://[2001:db8::1]:1080')).toEqual({
      type: 'socks5',
      host: '2001:db8::1',
      port: 1080,
    })
  })

  it('unbrackets an IPv6 MTProxy literal', () => {
    expect(parseProxyUrl('mtproto://[2001:db8::1]:443?secret=dd0123456789abcdef')).toEqual({
      type: 'mtproto',
      host: '2001:db8::1',
      port: 443,
      secret: 'dd0123456789abcdef',
    })
  })

  it('keeps SOCKS5 credentials and decodes them', () => {
    expect(parseProxyUrl('socks5://user:p%40ss%3Aword@proxy.example.com:1080')).toEqual({
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'p@ss:word',
    })
  })

  it('omits credentials that are not there instead of sending empty strings', () => {
    const config = parseProxyUrl('socks5://proxy.example.com:1080')
    expect(config).not.toBeNull()
    expect(config && 'username' in config).toBe(false)
    expect(config && 'password' in config).toBe(false)
  })

  it('parses a plain HTTP proxy URL', () => {
    expect(parseProxyUrl('http://127.0.0.1:8080')).toEqual({
      type: 'http',
      host: '127.0.0.1',
      port: 8080,
    })
  })

  it('keeps HTTP credentials and decodes them', () => {
    expect(parseProxyUrl('http://user:p%40ss@proxy.example.com:3128')).toEqual({
      type: 'http',
      host: 'proxy.example.com',
      port: 3128,
      username: 'user',
      password: 'p@ss',
    })
  })

  it('parses an MTProto URL with its secret', () => {
    expect(parseProxyUrl('mtproto://proxy.example.com:443?secret=dd0123456789abcdef')).toEqual({
      type: 'mtproto',
      host: 'proxy.example.com',
      port: 443,
      secret: 'dd0123456789abcdef',
    })
  })

  it('tolerates an MTProto URL without a secret (checked later by TDLib)', () => {
    expect(parseProxyUrl('mtproto://proxy.example.com:443')).toEqual({
      type: 'mtproto',
      host: 'proxy.example.com',
      port: 443,
    })
  })

  it('rejects a URL without a port', () => {
    expect(() => parseProxyUrl('socks5://127.0.0.1')).toThrow(/host and port/)
  })

  it('rejects HTTPS, because TDLib cannot speak TLS to the proxy itself', () => {
    expect(() => parseProxyUrl('https://127.0.0.1:8080')).toThrow(/unsupported proxy protocol/)
  })

  it('rejects a malformed URL', () => {
    expect(() => parseProxyUrl('not a url')).toThrow()
  })
})
