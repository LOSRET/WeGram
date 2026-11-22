import type { ProxyConfig } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { chooseCandidate } from './proxy-controller'

const socks: ProxyConfig = { type: 'socks5', host: '127.0.0.1', port: 7890 }
const http: ProxyConfig = { type: 'http', host: '127.0.0.1', port: 7892 }

/**
 * The precedence table of design doc §6.4. It is the rule that decides whether the
 * client reaches Telegram at all, and it has to stay readable: manual, then the dev
 * override, then the OS proxy, then direct.
 */
describe('chooseCandidate', () => {
  it('uses the manual configuration in manual mode', () => {
    expect(chooseCandidate({ mode: 'manual', manual: socks, env: null, system: http })).toEqual({
      config: socks,
      source: 'manual',
    })
  })

  it('connects directly when manual mode has no configuration', () => {
    expect(chooseCandidate({ mode: 'manual', manual: null, env: null, system: http })).toEqual({
      config: null,
      source: 'direct',
      detail: expect.any(String),
    })
  })

  it('ignores every proxy in off mode', () => {
    expect(chooseCandidate({ mode: 'off', manual: socks, env: socks, system: http })).toEqual({
      config: null,
      source: 'direct',
    })
  })

  it('follows the system proxy by default', () => {
    expect(chooseCandidate({ mode: 'system', manual: null, env: null, system: http })).toEqual({
      config: http,
      source: 'system',
    })
  })

  it('connects directly when the system has no proxy', () => {
    expect(chooseCandidate({ mode: 'system', manual: null, env: null, system: null })).toEqual({
      config: null,
      source: 'direct',
      detail: expect.any(String),
    })
  })

  it('lets the development override win over the system proxy', () => {
    expect(chooseCandidate({ mode: 'system', manual: null, env: socks, system: http })).toEqual({
      config: socks,
      source: 'env',
    })
  })

  it('never uses the stored manual configuration in 跟随系统代理', () => {
    // A leftover manual entry from an older profile must not sneak back in.
    expect(chooseCandidate({ mode: 'system', manual: socks, env: null, system: null })).toEqual({
      config: null,
      source: 'direct',
      detail: expect.any(String),
    })
  })
})
