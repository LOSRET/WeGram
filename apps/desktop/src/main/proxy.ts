import { MASK, type ProxyConfig } from '@wechatgram/protocol'

import { sealSecret, unsealSecret } from './security/secrets'
import type { StoredProxy } from './store/settings'

/** Stored → viewable config. Secrets are always replaced by `MASK`. */
export function toProxyView(stored: StoredProxy | null): ProxyConfig | null {
  if (!stored) return null
  if (stored.type === 'socks5') {
    return {
      type: 'socks5',
      host: stored.host,
      port: stored.port,
      ...(stored.username ? { username: stored.username } : {}),
      ...(stored.passwordSealed ? { password: MASK } : {}),
    }
  }
  return {
    type: 'mtproto',
    host: stored.host,
    port: stored.port,
    ...(stored.secretSealed ? { secret: MASK } : {}),
  }
}

/** Viewable config (+ `MASK` placeholders) → stored config with sealed secrets. */
export function toStoredProxy(config: ProxyConfig, previous: StoredProxy | null): StoredProxy {
  if (config.type === 'socks5') {
    const keptPassword =
      config.password === MASK && previous?.type === 'socks5' ? previous.passwordSealed : undefined
    return {
      type: 'socks5',
      host: config.host,
      port: config.port,
      ...(config.username ? { username: config.username } : {}),
      ...(config.password && config.password !== MASK
        ? { passwordSealed: sealSecret(config.password) }
        : keptPassword
          ? { passwordSealed: keptPassword }
          : {}),
    }
  }
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

/** Resolves `MASK` placeholders against what is already stored, for the adapter. */
export function resolveProxySecrets(config: ProxyConfig, previous: StoredProxy | null): ProxyConfig {
  if (config.type === 'socks5') {
    if (config.password !== MASK) return config
    const stored = previous?.type === 'socks5' ? unsealSecret(previous.passwordSealed) : null
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
