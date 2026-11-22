import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { ProxyMode } from '@wegram/protocol'

export interface StoredProxySocks5 {
  type: 'socks5'
  host: string
  port: number
  username?: string
  passwordSealed?: string
}

export interface StoredProxyHttp {
  type: 'http'
  host: string
  port: number
  username?: string
  passwordSealed?: string
}

export interface StoredProxyMtproto {
  type: 'mtproto'
  host: string
  port: number
  secretSealed?: string
}

export type StoredProxy = StoredProxySocks5 | StoredProxyHttp | StoredProxyMtproto

export interface StoredState {
  /** The manual configuration; only used while `proxyMode` is `manual`. */
  proxy: StoredProxy | null
  /**
   * Design doc §6.4: `system` (the default) follows the operating system proxy and
   * falls back to a direct connection when there is none, `manual` uses `proxy`,
   * `off` always connects directly.
   */
  proxyMode: ProxyMode
  /** TDLib's `prefer_ipv6`; applied by the adapter at startup and on change. */
  preferIpv6: boolean
}

const DEFAULT_STATE: StoredState = { proxy: null, proxyMode: 'system', preferIpv6: false }

function isProxyMode(value: unknown): value is ProxyMode {
  return value === 'system' || value === 'manual' || value === 'off'
}

/**
 * Small JSON store that holds what must be known before any window exists (the
 * proxy configuration, which carries a sealed secret, and the TDLib network
 * options). Everything else that is UI state lives in `ui.db` (§5.1).
 */
export class SettingsStore {
  private state: StoredState = { ...DEFAULT_STATE }

  constructor(private readonly file: string) {}

  load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredState>
      const proxy = parsed.proxy ?? null
      this.state = {
        proxy,
        // A file written before the modes existed keeps the proxy it already had
        // in force; a brand-new profile starts on 跟随系统代理.
        proxyMode: isProxyMode(parsed.proxyMode) ? parsed.proxyMode : proxy ? 'manual' : 'system',
        preferIpv6: parsed.preferIpv6 === true,
      }
    } catch {
      this.state = { ...DEFAULT_STATE }
    }
  }

  get(): Readonly<StoredState> {
    return this.state
  }

  setProxy(proxy: StoredProxy | null): void {
    this.state.proxy = proxy
    this.save()
  }

  setProxyMode(proxyMode: ProxyMode): void {
    this.state.proxyMode = proxyMode
    this.save()
  }

  setPreferIpv6(preferIpv6: boolean): void {
    this.state.preferIpv6 = preferIpv6
    this.save()
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (error) {
      console.error('[store] failed to persist settings:', error)
    }
  }
}
