import type { ProxyConfig } from '@wegram/protocol'

/**
 * The proxy form's fields, as strings — what an `<input>` holds (design doc §6.4).
 *
 * The 网络与代理 panel and the login window's modal show the same editor, so the
 * draft lives here instead of inside one of them: the two surfaces must not
 * disagree about what "the same proxy" means.
 */
export interface ProxyDraft {
  type: 'socks5' | 'http' | 'mtproto'
  host: string
  port: string
  username: string
  password: string
  secret: string
}

export const EMPTY_DRAFT: ProxyDraft = {
  type: 'socks5',
  host: '',
  port: '1080',
  username: '',
  password: '',
  secret: '',
}

/** A stored configuration (secrets arrive masked) as editable fields. */
export function draftFromConfig(config: ProxyConfig | null): ProxyDraft {
  if (!config) return EMPTY_DRAFT
  if (config.type === 'mtproto') {
    return {
      ...EMPTY_DRAFT,
      type: 'mtproto',
      host: config.host,
      port: String(config.port),
      secret: config.secret ?? '',
    }
  }
  return {
    ...EMPTY_DRAFT,
    type: config.type,
    host: config.host,
    port: String(config.port),
    username: config.username ?? '',
    password: config.password ?? '',
  }
}

/** The DTO these fields describe, or `null` when they cannot describe one. */
export function toProxyConfig(draft: ProxyDraft): ProxyConfig | null {
  const host = draft.host.trim()
  const port = Number(draft.port)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null

  if (draft.type === 'mtproto') {
    const secret = draft.secret.trim()
    return { type: 'mtproto', host, port, ...(secret ? { secret } : {}) }
  }

  const credentials = {
    ...(draft.username ? { username: draft.username } : {}),
    ...(draft.password ? { password: draft.password } : {}),
  }
  return draft.type === 'http'
    ? { type: 'http', host, port, ...credentials }
    : { type: 'socks5', host, port, ...credentials }
}

/** 「SOCKS5」/「HTTP」/「MTProxy」 — the one spelling the rows and the log use. */
export function proxyTypeLabel(type: ProxyConfig['type']): string {
  return type === 'socks5' ? 'SOCKS5' : type === 'http' ? 'HTTP' : 'MTProxy'
}

/** 「SOCKS5 127.0.0.1:7890」 — a row's title. */
export function describeProxy(config: ProxyConfig): string {
  return `${proxyTypeLabel(config.type)} ${config.host}:${config.port}`
}
