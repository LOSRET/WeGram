/**
 * The Telegram API credentials a packaged build carries.
 *
 * `api_id` / `api_hash` are not user secrets — every official client ships its own —
 * but they must belong to *this* deployment (my.telegram.org, design doc §10), so they
 * are never committed. `electron.vite.config.ts` inlines them into the main bundle at
 * build time from the environment, and release CI feeds that from repository secrets.
 */
export interface ApiCredentials {
  apiId: number
  apiHash: string
}

/**
 * Parses the JSON string the build inlined. Pure on purpose (see `proxy-url.ts`):
 * a source build inlines `""`, which is the "no credentials" case.
 */
export function parseApiCredentials(raw: string): ApiCredentials | null {
  if (!raw.trim()) return null

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // A malformed inline value is a broken build, and bootstrap reports it as such.
    return null
  }

  if (typeof value !== 'object' || value === null) return null
  if (!('apiId' in value) || !('apiHash' in value)) return null

  const { apiId, apiHash } = value
  if (typeof apiId !== 'number' || !Number.isInteger(apiId) || apiId <= 0) return null
  if (typeof apiHash !== 'string' || !apiHash) return null

  return { apiId, apiHash }
}
