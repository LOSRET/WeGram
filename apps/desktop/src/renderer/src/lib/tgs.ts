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

const cache = new Map<string, unknown>()
const failures = new Set<string>()

export async function loadTgsAnimation(url: string): Promise<unknown> {
  const cached = cache.get(url)
  if (cached) {
    // Refresh LRU order.
    cache.delete(url)
    cache.set(url, cached)
    return cached
  }
  if (failures.has(url)) throw new Error('TGS previously failed to decode')

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
  failures.add(url)
}
