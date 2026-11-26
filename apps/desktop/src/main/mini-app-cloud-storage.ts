const STORAGE_METHODS = new Set([
  'saveStorageValue',
  'getStorageValues',
  'deleteStorageValues',
  'getStorageKeys',
])
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_VALUE_LENGTH = 4096
const MAX_KEYS = 1024

export interface MiniAppCloudStorageRequest {
  reqId: string
  method: string
  parameters: string
}

export type MiniAppCloudStorageResult = { ok: true; value: unknown } | { ok: false; error: string }

/** The four CloudStorage methods official `telegram-web-app.js` sends. */
export function parseMiniAppCloudStorageRequest(
  raw: Record<string, unknown>,
): MiniAppCloudStorageRequest | null {
  const reqId = raw['req_id']
  const method = raw['method']
  const params = raw['params']
  if (typeof reqId !== 'string' || reqId.length === 0 || reqId.length > 128) return null
  if (typeof method !== 'string' || !STORAGE_METHODS.has(method)) return null
  if (!isRecord(params)) return null

  if (method === 'saveStorageValue') {
    const key = params['key']
    const value = params['value']
    if (!isStorageKey(key) || typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) {
      return null
    }
    return { reqId, method, parameters: JSON.stringify({ key, value }) }
  }

  if (method === 'getStorageValues' || method === 'deleteStorageValues') {
    const keys = params['keys']
    if (!Array.isArray(keys) || keys.length > MAX_KEYS || !keys.every(isStorageKey)) return null
    return { reqId, method, parameters: JSON.stringify({ keys }) }
  }

  return { reqId, method, parameters: '{}' }
}

/** TDLib returns JSON text; the adapter decodes it and this checks its shape. */
export function parseMiniAppCloudStorageResult(
  method: string,
  value: unknown,
): MiniAppCloudStorageResult {
  if (method === 'saveStorageValue' || method === 'deleteStorageValues') {
    return typeof value === 'boolean'
      ? { ok: true, value }
      : { ok: false, error: 'CloudStorage returned a non-boolean result' }
  }
  if (method === 'getStorageValues') {
    if (!isRecord(value)) return { ok: false, error: 'CloudStorage returned invalid values' }
    for (const [key, item] of Object.entries(value)) {
      if (!isStorageKey(key) || typeof item !== 'string') {
        return { ok: false, error: 'CloudStorage returned invalid values' }
      }
    }
    return { ok: true, value }
  }
  if (method === 'getStorageKeys') {
    if (!Array.isArray(value) || !value.every(isStorageKey)) {
      return { ok: false, error: 'CloudStorage returned invalid keys' }
    }
    return { ok: true, value }
  }
  return { ok: false, error: 'Unsupported CloudStorage method' }
}

function isStorageKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_PATTERN.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
