import type { ProxyConfig } from '@wegram/protocol'

/**
 * The pure half of reading the operating system's proxy (design doc §6.4).
 *
 * Kept apart from `system-proxy.ts` because that module talks to Electron and to
 * `reg.exe`, and `pnpm test` is Electron-free by design: these three parsers are
 * the part with rules worth pinning.
 */

/** `host:port` and `[::1]:port`; a bare host has no port and is unusable. */
export function splitHostPort(value: string): { host: string; port: number } | null {
  const match = /^(?:\[([^\]]+)\]|([^:[\]=]+)):(\d{1,5})$/.exec(value.trim().replace(/\/+$/, ''))
  if (!match) return null
  const host = (match[1] ?? match[2] ?? '').trim()
  const port = Number(match[3])
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, port }
}

/**
 * Chromium's answer for one URL: `DIRECT`, `PROXY host:port`,
 * `SOCKS5 host:port`, or a fallback list separated by `;`. The first entry TDLib
 * can speak is the one it gets.
 *
 * TDLib supports SOCKS5, an HTTP CONNECT tunnel and MTProxy. Chromium also reports
 * `SOCKS4`/`SOCKS4A` (PAC's bare `SOCKS`), which are skipped rather than applied
 * as something they are not.
 */
export function parseResolveProxyText(text: string): ProxyConfig | null {
  for (const part of text.split(';')) {
    const entry = part.trim()
    const space = entry.indexOf(' ')
    if (space < 1) continue
    const kind = entry.slice(0, space).toUpperCase()
    const target = splitHostPort(entry.slice(space + 1))
    if (!target) continue
    const type = kind === 'PROXY' || kind === 'HTTPS' ? 'http' : kind === 'SOCKS5' ? 'socks5' : null
    if (!type) continue
    return { type, host: target.host, port: target.port }
  }
  return null
}

/**
 * WinINET's `ProxyServer`: either `host:port` for every protocol, or a
 * `scheme=host:port` list. WinINET's `socks=` is SOCKS4, which TDLib cannot use,
 * so the CONNECT tunnel (`https=`, then `http=`) is what we take.
 */
export function parseRegistryProxyServer(value: string): ProxyConfig | null {
  // "host:port" is the every-protocol form; anything with an "=" is a scheme list.
  if (!value.includes('=')) {
    const direct = splitHostPort(value)
    if (direct) return { type: 'http', host: direct.host, port: direct.port }
  }

  const byScheme = new Map<string, string>()
  for (const part of value.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    byScheme.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim())
  }
  for (const scheme of ['https', 'http']) {
    const entry = byScheme.get(scheme)
    const target = entry ? splitHostPort(entry) : null
    if (target) return { type: 'http', host: target.host, port: target.port }
  }
  return null
}

export interface InternetSettings {
  enabled: boolean
  proxyServer: string | null
  autoConfigUrl: string | null
}

/** `reg query` output for the Internet Settings key (`REG_SZ`/`REG_DWORD`). */
export function parseInternetSettingsQuery(text: string): InternetSettings {
  const read = (name: string): string | null => {
    const match = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, 'm').exec(text)
    const value = match?.[1]?.trim()
    return value ? value : null
  }
  const enabled = read('ProxyEnable')
  return {
    enabled: enabled !== null && enabled !== '0' && enabled !== '0x0',
    proxyServer: read('ProxyServer'),
    autoConfigUrl: read('AutoConfigURL'),
  }
}
