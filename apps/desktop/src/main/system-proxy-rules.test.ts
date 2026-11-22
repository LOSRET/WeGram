import { describe, expect, it } from 'vitest'

import {
  parseInternetSettingsQuery,
  parseRegistryProxyServer,
  parseResolveProxyText,
  splitHostPort,
} from './system-proxy-rules'

/**
 * Reading the OS proxy is what makes the client work out of the box, and its
 * failure mode is silent (TDLib reports "offline" while the port is simply dead),
 * so every shape Chromium or WinINET can answer with is pinned here.
 */
describe('parseResolveProxyText', () => {
  it('reads DIRECT as "no proxy"', () => {
    expect(parseResolveProxyText('DIRECT')).toBeNull()
  })

  it('reads an HTTP proxy as the CONNECT tunnel TDLib speaks', () => {
    expect(parseResolveProxyText('PROXY 127.0.0.1:7892')).toEqual({
      type: 'http',
      host: '127.0.0.1',
      port: 7892,
    })
    expect(parseResolveProxyText('HTTPS proxy.example:3128')).toEqual({
      type: 'http',
      host: 'proxy.example',
      port: 3128,
    })
  })

  it('reads SOCKS5 as SOCKS5', () => {
    expect(parseResolveProxyText('SOCKS5 127.0.0.1:7890')).toEqual({
      type: 'socks5',
      host: '127.0.0.1',
      port: 7890,
    })
  })

  it('skips a fallback entry TDLib cannot speak and takes the next one', () => {
    expect(parseResolveProxyText('SOCKS4 10.0.0.1:1080; PROXY 127.0.0.1:7892')).toEqual({
      type: 'http',
      host: '127.0.0.1',
      port: 7892,
    })
    expect(parseResolveProxyText('SOCKS 10.0.0.1:1080; DIRECT')).toBeNull()
  })

  it('keeps an IPv6 literal unbracketed, like proxy-url.ts does', () => {
    expect(parseResolveProxyText('SOCKS5 [::1]:7890')).toEqual({
      type: 'socks5',
      host: '::1',
      port: 7890,
    })
  })

  it('ignores junk instead of throwing', () => {
    expect(parseResolveProxyText('')).toBeNull()
    expect(parseResolveProxyText('PROXY')).toBeNull()
    expect(parseResolveProxyText('PROXY 127.0.0.1')).toBeNull()
    expect(parseResolveProxyText('PROXY 127.0.0.1:99999')).toBeNull()
  })
})

describe('parseRegistryProxyServer', () => {
  it('reads the single host:port form WinINET writes for every protocol', () => {
    expect(parseRegistryProxyServer('127.0.0.1:7892')).toEqual({
      type: 'http',
      host: '127.0.0.1',
      port: 7892,
    })
  })

  it('prefers the https= entry of a per-scheme list', () => {
    expect(parseRegistryProxyServer('http=10.0.0.2:8080;https=10.0.0.3:8443')).toEqual({
      type: 'http',
      host: '10.0.0.3',
      port: 8443,
    })
    expect(parseRegistryProxyServer('ftp=10.0.0.9:21;http=10.0.0.2:8080')).toEqual({
      type: 'http',
      host: '10.0.0.2',
      port: 8080,
    })
  })

  it('refuses socks= alone: WinINET writes SOCKS4 there, which TDLib cannot speak', () => {
    expect(parseRegistryProxyServer('socks=127.0.0.1:1080')).toBeNull()
  })
})

describe('parseInternetSettingsQuery', () => {
  const output = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    '    ProxyEnable    REG_DWORD    0x1',
    '    ProxyServer    REG_SZ    127.0.0.1:7892',
    '    AutoConfigURL    REG_SZ    http://pac.example/proxy.pac',
    '',
  ].join('\r\n')

  it('reads the three values it needs', () => {
    expect(parseInternetSettingsQuery(output)).toEqual({
      enabled: true,
      proxyServer: '127.0.0.1:7892',
      autoConfigUrl: 'http://pac.example/proxy.pac',
    })
  })

  it('treats a disabled setting as no proxy even when a server is still stored', () => {
    expect(
      parseInternetSettingsQuery('    ProxyEnable    REG_DWORD    0x0'),
    ).toEqual({ enabled: false, proxyServer: null, autoConfigUrl: null })
  })
})

describe('splitHostPort', () => {
  it('rejects a host without a port', () => {
    expect(splitHostPort('127.0.0.1')).toBeNull()
    expect(splitHostPort(':1080')).toBeNull()
  })

  it('tolerates a trailing slash from a proxy URL', () => {
    expect(splitHostPort('proxy.example:3128/')).toEqual({ host: 'proxy.example', port: 3128 })
  })
})
