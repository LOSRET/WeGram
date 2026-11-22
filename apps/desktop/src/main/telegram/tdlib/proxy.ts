import type { ProxyConfig, ProxyTestResult } from '@wegram/protocol'

import { toAdapterError } from '../../util'
import type { Logger } from '../../util'
import type { TdObject } from './client'

/** What the proxy lifecycle needs from the adapter (§6.4). */
export interface ProxyDeps {
  invoke(method: TdObject): Promise<any>
  logger: Logger
}

function normalizeMtprotoSecret(secret: string): string {
  const cleaned = secret
    .trim()
    .replace(/^https?:\/\/t\.me\/proxy\?.*secret=/, '')
    .replace(/\s/g, '')
  return cleaned
}

/**
 * The TDLib `Proxy` object for a config.
 *
 * `http_only: false` asks for CONNECT tunnelling, so Telegram's TCP traffic can
 * go through an ordinary HTTP proxy; `true` would limit the proxy to HTTP
 * requests, which the protocol never makes.
 */
export function toTdlibProxy(config: ProxyConfig): TdObject {
  const type =
    config.type === 'socks5'
      ? {
          _: 'proxyTypeSocks5',
          username: config.username ?? '',
          password: config.password ?? '',
        }
      : config.type === 'http'
        ? {
            _: 'proxyTypeHttp',
            username: config.username ?? '',
            password: config.password ?? '',
            http_only: false,
          }
        : { _: 'proxyTypeMtproto', secret: normalizeMtprotoSecret(config.secret ?? '') }

  return { _: 'proxy', server: config.host, port: config.port, type }
}

/** Applies a proxy; may be called before authorization (TDLib allows that). */
export async function applyProxy(deps: ProxyDeps, config: ProxyConfig | null): Promise<void> {
  if (!config) {
    await deps.invoke({ _: 'disableProxy' }).catch(() => undefined)
    return
  }

  await deps.invoke({
    _: 'addProxy',
    proxy: toTdlibProxy(config),
    enable: true,
    comment: 'WeGram',
  })
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
 * One-shot connectivity check through TDLib's `pingProxy`: it opens a throwaway
 * connection using the candidate proxy and answers the round trip, so the proxy
 * currently in force is never touched (the previous implementation applied the
 * candidate, waited for `online` and restored it). Like `addProxy`, it may be
 * called before authorization.
 */
export async function testProxy(deps: ProxyDeps, config: ProxyConfig): Promise<ProxyTestResult> {
  try {
    const answer = await deps.invoke({ _: 'pingProxy', proxy: toTdlibProxy(config) })
    const seconds = typeof answer?.seconds === 'number' ? answer.seconds : null
    if (seconds === null) return { ok: false, error: 'No latency in the TDLib ping answer' }
    return { ok: true, latencyMs: Math.round(seconds * 1000) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
