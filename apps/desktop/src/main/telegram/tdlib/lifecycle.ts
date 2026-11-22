import type { AuthState, BootState, ProxyConfig } from '@wegram/protocol'
import { createClient } from 'tdl'

import type { Logger } from '../../util'
import type { AdapterEvent } from '../adapter'
import { BootTracker } from './boot'
import { configureTdlib, safeVersion } from './client'
import type { TdClientLike, TdObject } from './client'
import { applyProxy } from './proxy'
import type { ProxyDeps } from './proxy'

export interface TdlibClientOptions {
  apiId: number
  apiHash: string
  databaseDirectory: string
  filesDirectory: string
  useTestDc: boolean
  applicationVersion: string
  initialProxy: ProxyConfig | null
}

/** What the adapter lends the client lifecycle. */
export interface TdlibLifecycleDeps extends TdlibClientOptions {
  logger: Logger
  emit(event: AdapterEvent): void
  handleUpdate(update: TdObject): Promise<void>
  /** Authorization follows the client: a crash ends as `closed`. */
  setAuth(state: AuthState): void
  proxy: ProxyDeps
  /** TDLib's `prefer_ipv6`, read again on every (re)start. */
  preferIpv6: () => boolean
  /** Clears per-client adapter state (our own user id) before a restart. */
  onReset(): void
}

/**
 * The TDLib client's life: create it, wire its update stream, report its startup
 * phase and rebuild it for `auth:reset`.
 *
 * Kept beside the adapter because it has its own failure modes (a tdjson that
 * cannot be loaded, a database that cannot be opened, a client that dies), and
 * because the adapter itself is a flat list of protocol calls. The renderer's
 * login window shows this through `BootState`.
 */
export class TdlibLifecycle {
  private client: TdClientLike | null = null
  /** Set only by `stop()`: a close we asked for is not a crash. */
  private stopping = false
  private readonly boot: BootTracker

  constructor(private readonly deps: TdlibLifecycleDeps) {
    this.boot = new BootTracker((event) => deps.emit(event))
  }

  getBootState(): BootState {
    return this.boot.state
  }

  getClient(): TdClientLike | null {
    return this.client
  }

  /** TDLib answers its version only once the first update arrived. */
  version(): string {
    return safeVersion(this.client)
  }

  setBoot(state: BootState): void {
    this.boot.set(state)
  }

  noteConnectionBoot(state: BootState): void {
    this.boot.noteConnection(state)
  }

  async start(): Promise<void> {
    if (this.client) return
    this.boot.set({ kind: 'starting' })

    let client: TdClientLike
    try {
      configureTdlib(this.deps.logger)
      client = createClient({
        apiId: this.deps.apiId,
        apiHash: this.deps.apiHash,
        databaseDirectory: this.deps.databaseDirectory,
        filesDirectory: this.deps.filesDirectory,
        useTestDc: this.deps.useTestDc,
        tdlibParameters: {
          use_message_database: true,
          use_secret_chats: false,
          system_language_code: 'zh-hans',
          application_version: this.deps.applicationVersion,
          device_model: 'WeGram Desktop',
          system_version: 'Windows',
        },
      }) as unknown as TdClientLike
    } catch (error) {
      // A tdjson that cannot be loaded or a client that cannot be constructed
      // used to end in the log only, while the login window spun on "connecting"
      // forever (measured on the installed 0.1.1 build). Make it a state.
      this.boot.set({
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }

    this.client = client
    this.boot.set({ kind: 'opening' })

    // Every callback checks identity first: `restart()` drops this client and
    // creates another one, and a dying client must not touch the adapter.
    client.on('update', (update) => {
      if (this.client !== client) return
      void this.deps.handleUpdate(update).catch((error) => {
        this.deps.logger.warn(
          'update handler failed:',
          error instanceof Error ? error.message : error,
        )
      })
    })
    client.on('error', (error) => {
      if (this.client !== client) return
      this.boot.noteError(error.message)
      this.deps.logger.warn('client error:', error.message)
    })
    client.on('close', () => {
      if (this.client !== client) return
      // `stop()` closes the client on purpose; anything else means TDLib went
      // away by itself, which the login window reports as a crash.
      if (!this.stopping) this.boot.crash()
      this.deps.setAuth({ kind: 'closed' })
    })

    // Network preference first: it decides which DC addresses new connections
    // may use, and TDLib replans the existing ones when the option changes.
    this.applyPreferIpv6(client)

    // Proxy must be in place before any network request (§6.4). tdl queues
    // requests until it has sent the TDLib parameters, so calling it here is
    // both safe and early enough.
    if (this.deps.initialProxy) {
      const proxy = this.deps.initialProxy
      void applyProxy(this.deps.proxy, proxy)
        .then(() =>
          this.deps.logger.info(`initial proxy applied: ${proxy.type} ${proxy.host}:${proxy.port}`),
        )
        .catch((error) =>
          this.deps.logger.warn(
            'initial proxy failed:',
            error instanceof Error ? error.message : String(error),
          ),
        )
    }

    // Version is only known once TDLib emits its first update, so it is not
    // available here; report it when authorization settles instead.
    this.deps.logger.info('TDLib client created')
  }

  async stop(): Promise<void> {
    if (!this.client) return
    this.stopping = true
    try {
      await this.client.close()
    } finally {
      this.client = null
      this.stopping = false
    }
  }

  /** `destroy` deletes the database: the replacement waits for the old `close`. */
  async restart(): Promise<void> {
    const client = this.client
    if (client) {
      // Detach first: the old client's close/update callbacks must not fire into
      // the adapter while the replacement is starting.
      this.client = null
      const closed = new Promise<void>((resolve) => {
        client.on('close', () => resolve())
      })
      try {
        await client.invoke({ _: 'destroy' })
      } catch (error) {
        this.deps.logger.warn(
          'destroy failed:',
          error instanceof Error ? error.message : String(error),
        )
      }
      await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 5_000))])
    }

    this.deps.onReset()
    await this.start()
  }

  /** Best effort: a failed option must not keep the client from coming up. */
  private applyPreferIpv6(client: TdClientLike): void {
    void client
      .invoke({
        _: 'setOption',
        name: 'prefer_ipv6',
        value: { _: 'optionValueBoolean', value: this.deps.preferIpv6() },
      })
      .catch((error) => {
        this.deps.logger.warn(
          'failed to set prefer_ipv6:',
          error instanceof Error ? error.message : error,
        )
      })
  }
}
