/**
 * TGS = gzip(Lottie JSON), a user-controlled binary (design doc §10).
 *
 * Guards, in order: compressed size, decompressed size, expansion ratio, and a
 * minimal shape check before lottie-web ever sees the data. Decoded animations
 * are cached with a small LRU because the same sticker usually appears many
 * times in a chat and re-inflating it on every scroll would show up as jank.
 */

const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024
const MAX_JSON_BYTES = 8 * 1024 * 1024
/** TGS normally expands ~5-20×; anything past this is a decompression bomb. */
const MAX_EXPANSION_RATIO = 80
const CACHE_LIMIT = 24
/** A failed URL is not retried for this long, then it is allowed one more try. */
const FAILURE_COOLDOWN_MS = 60_000

const cache = new Map<string, unknown>()
/** The decompressed JSON text, for a renderer that parses it itself (ThorVG). */
const textCache = new Map<string, string>()
const failures = new Map<string, number>()

/**
 * A decode failure used to be permanent for the session, so one bad download hid
 * that sticker until the app restarted. It is now a cooldown: repeated failures
 * still do not hammer the disk, but a transient one heals.
 */
function recentlyFailed(url: string): boolean {
  const failedAt = failures.get(url)
  if (failedAt === undefined) return false
  if (Date.now() - failedAt < FAILURE_COOLDOWN_MS) return true
  failures.delete(url)
  return false
}

/**
 * The decompressed Lottie JSON text, measured against the same guards as the
 * decoded object. ThorVG's canvas parses Lottie itself, so the grid hands it this
 * string instead of an already-parsed tree.
 */
export async function loadTgsText(url: string): Promise<string> {
  const cached = textCache.get(url)
  if (cached !== undefined) {
    // Refresh LRU order.
    textCache.delete(url)
    textCache.set(url, cached)
    return cached
  }
  if (recentlyFailed(url)) throw new Error('TGS recently failed to decode')

  const response = await fetch(url)
  if (!response.ok) throw new Error(`TGS fetch failed: ${response.status}`)
  const compressed = await response.arrayBuffer()
  if (compressed.byteLength === 0) throw new Error('TGS is empty')
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new Error('TGS too large')

  const decompressed = await new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer()
  if (decompressed.byteLength > MAX_JSON_BYTES) throw new Error('TGS expands too far')

  const ratio = decompressed.byteLength / compressed.byteLength
  if (ratio > MAX_EXPANSION_RATIO) throw new Error(`TGS expansion ratio ${Math.round(ratio)}x`)

  const text = new TextDecoder().decode(decompressed)
  textCache.set(url, text)
  while (textCache.size > CACHE_LIMIT) {
    const oldest = textCache.keys().next().value
    if (oldest === undefined) break
    textCache.delete(oldest)
  }
  return text
}

export async function loadTgsAnimation(url: string): Promise<unknown> {
  const cached = cache.get(url)
  if (cached) {
    // Refresh LRU order.
    cache.delete(url)
    cache.set(url, cached)
    return cached
  }

  const text = await loadTgsText(url)
  const data: unknown = JSON.parse(text)
  if (!isLottie(data)) throw new Error('TGS payload is not a Lottie animation')

  cache.set(url, data)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return data
}

function isLottie(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    Array.isArray(record['layers']) &&
    typeof record['w'] === 'number' &&
    typeof record['h'] === 'number'
  )
}

export function markTgsFailure(url: string): void {
  failures.set(url, Date.now())
}
