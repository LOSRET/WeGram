import { MASK, type ProxyConfig } from '@wegram/protocol'

import { sealSecret, unsealSecret } from './security/secrets'
import type { StoredProxy } from './store/settings'

/** Stored → viewable config. Secrets are always replaced by `MASK`. */
export function toProxyView(stored: StoredProxy | null): ProxyConfig | null {
  if (!stored) return null
  if (stored.type === 'mtproto') {
    return {
      type: 'mtproto',
      host: stored.host,
      port: stored.port,
      ...(stored.secretSealed ? { secret: MASK } : {}),
    }
  }
  const credentials = {
    ...(stored.username ? { username: stored.username } : {}),
    ...(stored.passwordSealed ? { password: MASK } : {}),
  }
  return stored.type === 'socks5'
    ? { type: 'socks5', host: stored.host, port: stored.port, ...credentials }
    : { type: 'http', host: stored.host, port: stored.port, ...credentials }
}

/** Viewable config (+ `MASK` placeholders) → stored config with sealed secrets. */
export function toStoredProxy(config: ProxyConfig, previous: StoredProxy | null): StoredProxy {
  if (config.type === 'mtproto') {
    const keptSecret =
      config.secret === MASK && previous?.type === 'mtproto' ? previous.secretSealed : undefined
    return {
      type: 'mtproto',
      host: config.host,
      port: config.port,
      ...(config.secret && config.secret !== MASK
        ? { secretSealed: sealSecret(config.secret) }
        : keptSecret
          ? { secretSealed: keptSecret }
          : {}),
    }
  }

  // A kept password belongs to the same kind of proxy: switching SOCKS5 ↔ HTTP
  // keeps the address fields but must not carry the other kind's credentials.
  const keptPassword =
    config.password === MASK && previous?.type === config.type ? previous.passwordSealed : undefined
  const passwordSealed =
    config.password && config.password !== MASK ? sealSecret(config.password) : keptPassword
  const stored = {
    host: config.host,
    port: config.port,
    ...(config.username ? { username: config.username } : {}),
    ...(passwordSealed ? { passwordSealed } : {}),
  }
  return config.type === 'socks5' ? { type: 'socks5', ...stored } : { type: 'http', ...stored }
}

/** Resolves `MASK` placeholders against what is already stored, for the adapter. */
export function resolveProxySecrets(
  config: ProxyConfig,
  previous: StoredProxy | null,
): ProxyConfig {
  if (config.type === 'socks5') {
    if (config.password !== MASK) return config
    const stored = previous?.type === 'socks5' ? unsealSecret(previous.passwordSealed) : null
    return { ...config, password: stored ?? '' }
  }
  if (config.type === 'http') {
    if (config.password !== MASK) return config
    const stored = previous?.type === 'http' ? unsealSecret(previous.passwordSealed) : null
    return { ...config, password: stored ?? '' }
  }
  if (config.secret !== MASK) return config
  const stored = previous?.type === 'mtproto' ? unsealSecret(previous.secretSealed) : null
  return { ...config, secret: stored ?? '' }
}

export function storedProxyToConfig(stored: StoredProxy | null): ProxyConfig | null {
  const view = toProxyView(stored)
  if (!view || !stored) return null
  return resolveProxySecrets(view, stored)
}
