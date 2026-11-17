import { AppError } from '@wegram/protocol'
import type { ProxyConfig, ProxyTestResult } from '@wegram/protocol'

import { toAdapterError } from '../../util'
import type { Logger } from '../../util'
import type { TdObject } from './client'

/** What the proxy lifecycle needs from the adapter (§6.4). */
export interface ProxyDeps {
  invoke(method: TdObject): Promise<any>
  logger: Logger
  /** The proxy currently enabled, if any. */
  getProxy(): ProxyConfig | null
  /** Records the proxy that is now in force (`null` after `disableProxy`). */
  setProxyState(config: ProxyConfig | null): void
  isOnline(): boolean
}

function normalizeMtprotoSecret(secret: string): string {
  const cleaned = secret
    .trim()
    .replace(/^https?:\/\/t\.me\/proxy\?.*secret=/, '')
    .replace(/\s/g, '')
  return cleaned
}

/** Applies a proxy; may be called before authorization (TDLib allows that). */
export async function applyProxy(deps: ProxyDeps, config: ProxyConfig | null): Promise<void> {
  if (!config) {
    await deps.invoke({ _: 'disableProxy' }).catch(() => undefined)
    deps.setProxyState(null)
    return
  }

  const type =
    config.type === 'socks5'
      ? {
          _: 'proxyTypeSocks5',
          username: config.username ?? '',
          password: config.password ?? '',
        }
      : { _: 'proxyTypeMtproto', secret: normalizeMtprotoSecret(config.secret ?? '') }

  await deps.invoke({
    _: 'addProxy',
    proxy: { _: 'proxy', server: config.host, port: config.port, type },
    enable: true,
    comment: 'WeGram',
  })
  deps.setProxyState(config)
  deps.logger.info(`proxy enabled: ${config.type} ${config.host}:${config.port}`)
}

export async function setProxy(deps: ProxyDeps, config: ProxyConfig | null): Promise<void> {
  try {
    await applyProxy(deps, config)
  } catch (error) {
    throw toAdapterError(error, 'Failed to apply proxy')
  }
}

/**
 * Enables the candidate proxy, waits for a real connection to come up, then
 * restores the previous configuration. Never silently reports success.
 */
export async function testProxy(deps: ProxyDeps, config: ProxyConfig): Promise<ProxyTestResult> {
  const previous = deps.getProxy()
  const startedAt = Date.now()
  try {
    await applyProxy(deps, config)
    await waitForOnline(deps, 8_000)
    return { ok: true, latencyMs: Date.now() - startedAt }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await applyProxy(deps, previous).catch(() => undefined)
  }
}

export async function waitForOnline(deps: ProxyDeps, timeoutMs: number): Promise<void> {
  if (deps.isOnline()) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (deps.isOnline()) return
  }
  throw new AppError(
    'proxy_failed',
    'Proxy did not reach an online connection within 8 seconds — check host, port and secret',
  )
}
