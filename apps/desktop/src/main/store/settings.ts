import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface StoredProxySocks5 {
  type: 'socks5'
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

export type StoredProxy = StoredProxySocks5 | StoredProxyMtproto

export interface StoredState {
  proxy: StoredProxy | null
}

const DEFAULT_STATE: StoredState = { proxy: null }

/**
 * Small JSON store that only holds what carries a sealed secret (the proxy
 * configuration). Everything else that is UI state lives in `ui.db` (§5.1).
 */
export class SettingsStore {
  private state: StoredState = { ...DEFAULT_STATE }

  constructor(private readonly file: string) {}

  load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredState>
      this.state = { proxy: parsed.proxy ?? null }
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
