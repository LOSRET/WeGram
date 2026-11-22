import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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
  proxy: StoredProxy | null
  /** TDLib's `prefer_ipv6`; applied by the adapter at startup and on change. */
  preferIpv6: boolean
}

const DEFAULT_STATE: StoredState = { proxy: null, preferIpv6: false }

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
      this.state = { proxy: parsed.proxy ?? null, preferIpv6: parsed.preferIpv6 === true }
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
