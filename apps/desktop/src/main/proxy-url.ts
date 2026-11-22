import type { ProxyConfig } from '@wegram/protocol'

/**
 * Parses a proxy URL into a protocol DTO. Pure function on purpose: it is used
 * by the main process and by the headless smoke script, neither of which may
 * pull in Electron-only modules.
 *
 *   socks5://127.0.0.1:7890
 *   socks5://user:pass@127.0.0.1:1080
 *   socks5://[::1]:1080
 *   http://127.0.0.1:8080
 *   http://user:pass@proxy.example.com:3128
 *   mtproto://proxy.example.com:443?secret=dd0123...
 *
 * `http` is a CONNECT tunnel (TDLib `proxyTypeHttp` with `http_only: false`);
 * TDLib cannot speak TLS to the proxy itself, so `https://` stays unsupported.
 *
 * A WHATWG URL keeps an IPv6 literal bracketed, but TDLib's proxy `server` is
 * handed to getaddrinfo as-is and a bracketed literal never resolves, so the
 * brackets are stripped here.
 */
export function sameProxy(a: ProxyConfig | null, b: ProxyConfig | null): boolean {
  if (a === null || b === null) return a === b
  if (a.type !== b.type || a.host !== b.host || a.port !== b.port) return false
  const credentials = (config: ProxyConfig): string =>
    config.type === 'mtproto'
      ? (config.secret ?? '')
      : `${config.username ?? ''}\u0000${config.password ?? ''}`
  return credentials(a) === credentials(b)
}

/** 「SOCKS5 127.0.0.1:7890」 — the one spelling used in logs and in the panel. */
export function describeProxy(config: ProxyConfig): string {
  const label = config.type === 'socks5' ? 'SOCKS5' : config.type === 'http' ? 'HTTP' : 'MTProxy'
  return `${label} ${config.host}:${config.port}`
}

export function parseProxyUrl(raw: string | undefined | null): ProxyConfig | null {
  const value = raw?.trim()
  if (!value) return null

  const url = new URL(value)
  const port = Number(url.port)
  if (!url.hostname || !port) throw new Error(`proxy URL needs a host and port: ${value}`)
  const host =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname

  const credentials = {
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  }

  if (url.protocol === 'socks5:') {
    return { type: 'socks5', host, port, ...credentials }
  }

  if (url.protocol === 'http:') {
    return { type: 'http', host, port, ...credentials }
  }

  if (url.protocol === 'mtproto:') {
    const secret = url.searchParams.get('secret')
    return { type: 'mtproto', host, port, ...(secret ? { secret } : {}) }
  }

  throw new Error(`unsupported proxy protocol: ${url.protocol}`)
}
