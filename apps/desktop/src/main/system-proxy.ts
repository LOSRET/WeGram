import { execFile } from 'node:child_process'
import { createConnection } from 'node:net'

import type { ProxyConfig } from '@wegram/protocol'
import { session as electronSession } from 'electron'

import {
  parseInternetSettingsQuery,
  parseRegistryProxyServer,
  parseResolveProxyText,
} from './system-proxy-rules'
import type { Logger } from './util'

/**
 * Reading the operating system's proxy (design doc §6.4).
 *
 * Two sources, in this order:
 *
 * - Chromium's own resolution (`session.resolveProxy` on a private, memory-only
 *   partition). It reads the Windows proxy settings *and* evaluates a PAC script
 *   or WPAD, which we could not do ourselves.
 * - The registry key WinINET writes (`…\Internet Settings`), used only when
 *   Chromium does not answer in time (a PAC that has to be fetched first, a proxy
 *   helper that is wedged). It covers the static `ProxyServer` form — the one
 *   Clash, v2rayN and the game accelerators write.
 *
 * The parsers live in `system-proxy-rules.ts` so `pnpm test` can pin them.
 * Nothing here applies a proxy; `proxy-controller.ts` owns the precedence rules
 * and the reachability check.
 */
const PROBE_URL = 'https://api.telegram.org/'
const PROBE_TIMEOUT_MS = 2500
const TCP_TIMEOUT_MS = 1500
const INTERNET_SETTINGS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

export interface SystemProxyReading {
  /** What the OS wants us to use, or `null` for a direct connection. */
  config: ProxyConfig | null
  /** Which source answered; `none` means "no proxy is configured". */
  via: 'chromium' | 'registry' | 'none'
  /** The raw answer, kept for the log line and the panel's sentence. */
  raw: string
}

function runRegQuery(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', INTERNET_SETTINGS_KEY],
      { windowsHide: true, timeout: 2000 },
      (error, stdout) => resolve(error ? null : stdout),
    )
  })
}

let probeSession: Electron.Session | null = null

/**
 * An answer from Chromium, or `null` when it did not produce one in time.
 *
 * The probe session is memory-only (`wegram-proxy-probe` has no `persist:` prefix)
 * and never loads a page: it exists so the answer cannot be influenced by a
 * window's session, and so probing never changes what the app's own windows use.
 */
async function askChromium(logger: Logger): Promise<string | null> {
  try {
    probeSession ??= electronSession.fromPartition('wegram-proxy-probe')
    await probeSession.setProxy({ mode: 'system' })
    const answer = await Promise.race([
      probeSession.resolveProxy(PROBE_URL),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PROBE_TIMEOUT_MS)),
    ])
    return typeof answer === 'string' ? answer : null
  } catch (error) {
    logger.warn(
      'system proxy: Chromium did not answer:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/** What the operating system reports right now; no reachability check. */
export async function readSystemProxy(logger: Logger): Promise<SystemProxyReading> {
  const answer = await askChromium(logger)
  if (answer !== null) {
    const config = parseResolveProxyText(answer)
    logger.info(`system proxy: ${answer}${config ? ` → ${config.type} ${config.host}:${config.port}` : ''}`)
    return { config, via: config ? 'chromium' : 'none', raw: answer }
  }

  const text = await runRegQuery()
  if (text === null) return { config: null, via: 'none', raw: '' }
  const settings = parseInternetSettingsQuery(text)
  if (!settings.enabled) return { config: null, via: 'none', raw: settings.autoConfigUrl ?? '' }
  const config = settings.proxyServer ? parseRegistryProxyServer(settings.proxyServer) : null
  logger.info(
    `system proxy (registry): ${settings.proxyServer ?? settings.autoConfigUrl ?? 'none'}`,
  )
  return { config, via: config ? 'registry' : 'none', raw: settings.proxyServer ?? '' }
}

/**
 * Is anything accepting connections there?
 *
 * A dead port is the dominant failure — a proxy client was closed while the OS
 * still points at it — and this check needs no TDLib client, which is what makes
 * it usable for the startup decision (TDLib must be created *with* its proxy, §6.4).
 */
export function reachableOverTcp(config: ProxyConfig): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: config.host, port: config.port })
    const settle = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(TCP_TIMEOUT_MS)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}
