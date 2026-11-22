import type { ProxyConfig, ProxyMode, ProxyState, ProxySource, ProxyTestResult } from '@wegram/protocol'

import { describeProxy, sameProxy } from './proxy-url'
import type { SystemProxyReading } from './system-proxy'
import type { Logger } from './util'

/**
 * The one place that decides which proxy TDLib uses (design doc §6.4).
 *
 * Precedence: an explicit manual configuration, then the development
 * `WEGRAM_PROXY` override, then the operating system's proxy, then a direct
 * connection — which is what every other messenger does out of the box.
 *
 * Two rules keep a stale OS proxy from making the client look offline:
 *
 * - Only a proxy the user did *not* choose (the OS's, or the env override) is
 *   probed. A manual configuration is applied as written: a broken one is the
 *   user's decision and 测试连通性 explains it.
 * - A proxy that fails its probe falls back to a direct connection and is probed
 *   again after `RETRY_MS`, so closing and reopening the proxy client heals
 *   itself without the reader touching anything.
 */
const RETRY_MS = 30_000
const POLL_MS = 30_000

export interface Candidate {
  config: ProxyConfig | null
  source: ProxySource
  /** Explains a `null` config that came from the mode rather than from "no proxy". */
  detail?: string
}

/** The precedence rule, as a pure function so the table above has a test. */
export function chooseCandidate(input: {
  mode: ProxyMode
  manual: ProxyConfig | null
  env: ProxyConfig | null
  system: ProxyConfig | null
}): Candidate {
  if (input.mode === 'off') return { config: null, source: 'direct' }
  if (input.mode === 'manual') {
    return input.manual
      ? { config: input.manual, source: 'manual' }
      : { config: null, source: 'direct', detail: '手动模式未填写代理，本次直连' }
  }
  if (input.env) return { config: input.env, source: 'env' }
  if (input.system) return { config: input.system, source: 'system' }
  return { config: null, source: 'direct', detail: '系统未配置代理，直连' }
}

/** What the controller needs from the adapter; absent until the client exists. */
export interface ProxyApplication {
  applyProxy: (config: ProxyConfig | null) => Promise<void>
  /** TDLib's `pingProxy`: one throwaway connection, current proxy untouched. */
  testProxy?: (config: ProxyConfig) => Promise<ProxyTestResult>
}

export interface ProxyControllerDeps {
  mode: () => ProxyMode
  /** The manual configuration with its secrets resolved (never crosses IPC). */
  manualConfig: () => ProxyConfig | null
  /** The manual configuration as the renderer may see it (secrets masked). */
  manualView: () => ProxyConfig | null
  /** Development-only `WEGRAM_PROXY`; `null` when unset. */
  envProxy: ProxyConfig | null
  readSystemProxy: () => Promise<SystemProxyReading>
  /**
   * Bare liveness of a candidate. The startup decision has no TDLib client yet
   * (TDLib must be created *with* its proxy), so a TCP connect is what it can use.
   */
  reachable?: (config: ProxyConfig) => Promise<boolean>
  logger: Logger
  /** Published when the proxy in force changes without an IPC call (`evt:proxy`). */
  onChange?: (state: ProxyState) => void
  pollMs?: number
}

interface Probe {
  config: ProxyConfig
  ok: boolean
  latencyMs?: number
  at: number
}

export class ProxyController {
  private application: ProxyApplication | null = null
  private stateValue: ProxyState | null = null
  /** `undefined` means "not applied by us yet" (the adapter was created with it). */
  private applied: ProxyConfig | null | undefined = undefined
  private probeCache: Probe | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: ProxyControllerDeps) {}

  attach(application: ProxyApplication): void {
    this.application = application
  }

  /** Adopts the proxy the adapter was constructed with, so it is not applied twice. */
  markApplied(config: ProxyConfig | null): void {
    this.applied = config
  }

  /** The state of the last resolution; `null` before the first one. */
  state(): ProxyState | null {
    return this.stateValue
  }

  /** Serialised: a poll and an IPC call must not apply two proxies at once. */
  resolve(options: { apply?: boolean } = {}): Promise<ProxyState> {
    const run = this.chain.then(() => this.resolveNow(options.apply !== false))
    this.chain = run.catch(() => undefined)
    return run
  }

  /** 重新检测: forget the cached verdict, then resolve again. */
  refresh(): Promise<ProxyState> {
    this.probeCache = null
    return this.resolve()
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.resolve().catch((error: unknown) => this.deps.logger.warn('proxy poll failed:', error))
    }, this.deps.pollMs ?? POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async resolveNow(apply: boolean): Promise<ProxyState> {
    const mode = this.deps.mode()
    const reading = mode === 'system' ? await this.deps.readSystemProxy() : null
    const candidate = chooseCandidate({
      mode,
      manual: this.deps.manualConfig(),
      env: this.deps.envProxy,
      system: reading?.config ?? null,
    })

    let active = candidate.config
    let detail = candidate.detail
    if (active && candidate.source !== 'manual') {
      const verdict = await this.check(active)
      if (verdict.ok) {
        detail = verdict.latencyMs === undefined ? undefined : `${describeProxy(active)} · ${verdict.latencyMs}ms`
      } else {
        detail = `${describeProxy(active)} 无响应，本次直连（${Math.round(RETRY_MS / 1000)} 秒后重试）`
        active = null
      }
    }
    if (active && candidate.source === 'manual') detail = undefined

    const next: ProxyState = {
      mode,
      config: this.deps.manualView(),
      system: mode === 'system' ? (reading?.config ?? null) : null,
      active,
      source: active ? candidate.source : 'direct',
      ...(detail ? { detail } : {}),
    }

    const applied = this.applied
    if (apply && (applied === undefined || !sameProxy(applied, active))) {
      await this.apply(active)
    }

    const changed = this.stateValue === null || JSON.stringify(this.stateValue) !== JSON.stringify(next)
    this.stateValue = next
    if (changed) this.deps.onChange?.(next)
    return next
  }

  private async apply(config: ProxyConfig | null): Promise<void> {
    const application = this.application
    if (!application) return
    try {
      await application.applyProxy(config)
      this.applied = config
      this.deps.logger.info(
        config ? `proxy in force: ${describeProxy(config)}` : 'proxy off: direct connection',
      )
    } catch (error) {
      // Leave `applied` unknown so the next resolve tries again instead of
      // believing a proxy TDLib refused.
      this.applied = undefined
      this.probeCache = null
      this.deps.logger.warn(
        'failed to apply the proxy:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  /**
   * A successful verdict is kept for as long as the candidate does not change
   * (steady state costs no probe, §6.4), while a failure expires after
   * `RETRY_MS` so the retry is what heals a proxy that came back.
   */
  private async check(config: ProxyConfig): Promise<{ ok: boolean; latencyMs?: number }> {
    const cached = this.probeCache
    if (cached && sameProxy(cached.config, config)) {
      if (cached.ok) {
        return cached.latencyMs === undefined ? { ok: true } : { ok: true, latencyMs: cached.latencyMs }
      }
      if (Date.now() - cached.at < RETRY_MS) return { ok: false }
    }

    const verdict = await this.probe(config)
    this.probeCache = { config, ok: verdict.ok, latencyMs: verdict.latencyMs, at: Date.now() }
    return verdict
  }

  private async probe(config: ProxyConfig): Promise<{ ok: boolean; latencyMs?: number }> {
    const testProxy = this.application?.testProxy
    if (testProxy) {
      const result = await testProxy(config)
      this.deps.logger.info(
        `proxy probe ${describeProxy(config)}: ${result.ok ? `${result.latencyMs ?? 0}ms` : (result.error ?? 'failed')}`,
      )
      if (!result.ok) return { ok: false }
      return result.latencyMs === undefined ? { ok: true } : { ok: true, latencyMs: result.latencyMs }
    }

    const reachable = this.deps.reachable
    if (!reachable) return { ok: true }
    const ok = await reachable(config)
    this.deps.logger.info(`proxy probe ${describeProxy(config)}: ${ok ? 'port open' : 'no listener'}`)
    return { ok }
  }
}
