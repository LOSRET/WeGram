import type { ProxyConfig } from '@wechatgram/protocol'

/**
 * Parses a proxy URL into a protocol DTO. Pure function on purpose: it is used
 * by the main process and by the headless smoke script, neither of which may
 * pull in Electron-only modules.
 *
 *   socks5://127.0.0.1:7890
 *   socks5://user:pass@127.0.0.1:1080
 *   mtproto://proxy.example.com:443?secret=dd0123...
 */
export function parseProxyUrl(raw: string | undefined | null): ProxyConfig | null {
  const value = raw?.trim()
  if (!value) return null

  const url = new URL(value)
  const port = Number(url.port)
  if (!url.hostname || !port) throw new Error(`proxy URL needs a host and port: ${value}`)

  if (url.protocol === 'socks5:') {
    return {
      type: 'socks5',
      host: url.hostname,
      port,
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    }
  }

  if (url.protocol === 'mtproto:') {
    const secret = url.searchParams.get('secret')
    return { type: 'mtproto', host: url.hostname, port, ...(secret ? { secret } : {}) }
  }

  throw new Error(`unsupported proxy protocol: ${url.protocol}`)
}
