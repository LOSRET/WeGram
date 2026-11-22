import { describe, expect, it } from 'vitest'

import type { ProxyConfig } from '@wegram/protocol'

import type { TdObject } from './client'
import { testProxy, toTdlibProxy } from './proxy'
import type { ProxyDeps } from './proxy'

const logger = { info: () => {}, warn: () => {}, error: () => {} }

function depsAnswering(answer: (method: TdObject) => unknown): {
  deps: ProxyDeps
  calls: TdObject[]
} {
  const calls: TdObject[] = []
  return {
    calls,
    deps: {
      invoke: async (method) => {
        calls.push(method)
        return answer(method)
      },
      logger,
    },
  }
}

const socks5: ProxyConfig = { type: 'socks5', host: '127.0.0.1', port: 7890 }
const http: ProxyConfig = {
  type: 'http',
  host: 'proxy.example.com',
  port: 3128,
  username: 'user',
  password: 'secret',
}

describe('toTdlibProxy', () => {
  it('maps SOCKS5 with empty credentials instead of omitting them', () => {
    expect(toTdlibProxy(socks5)).toEqual({
      _: 'proxy',
      server: '127.0.0.1',
      port: 7890,
      type: { _: 'proxyTypeSocks5', username: '', password: '' },
    })
  })

  it('maps HTTP with http_only false so TDLib tunnels TCP through CONNECT', () => {
    expect(toTdlibProxy(http)).toEqual({
      _: 'proxy',
      server: 'proxy.example.com',
      port: 3128,
      type: {
        _: 'proxyTypeHttp',
        username: 'user',
        password: 'secret',
        http_only: false,
      },
    })
  })

  it('normalizes a pasted MTProxy link into the bare secret', () => {
    expect(
      toTdlibProxy({
        type: 'mtproto',
        host: 'proxy.example.com',
        port: 443,
        secret: ' https://t.me/proxy?server=proxy.example.com&port=443&secret=dd01 23 ',
      }),
    ).toEqual({
      _: 'proxy',
      server: 'proxy.example.com',
      port: 443,
      type: { _: 'proxyTypeMtproto', secret: 'dd0123' },
    })
  })
})

describe('testProxy', () => {
  it('pings the candidate without applying it', async () => {
    const { deps, calls } = depsAnswering(() => ({ _: 'seconds', seconds: 0.25 }))

    await expect(testProxy(deps, http)).resolves.toEqual({ ok: true, latencyMs: 250 })
    expect(calls.map((call) => call._)).toEqual(['pingProxy'])
  })

  it('reports a failed ping as a result instead of throwing', async () => {
    const { deps } = depsAnswering(() => {
      throw new Error('Proxy unavailable')
    })

    await expect(testProxy(deps, http)).resolves.toEqual({
      ok: false,
      error: 'Proxy unavailable',
    })
  })

  it('treats a ping answer without latency as a failure', async () => {
    const { deps } = depsAnswering(() => ({ _: 'ok' }))

    const result = await testProxy(deps, http)
    expect(result.ok).toBe(false)
  })
})
