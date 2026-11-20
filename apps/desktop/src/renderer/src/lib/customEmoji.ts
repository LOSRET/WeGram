import type { CustomEmojiSticker } from '@wegram/protocol'

import { invoke } from './ipc'

/**
 * Custom emoji artwork, resolved once per id and cached for the session.
 *
 * A premium post can carry several `customEmoji` entities and the transcript
 * re-mounts its rows constantly, so:
 * - the sticker *documents* are fetched once per id (a Map, not React state);
 * - lookups made in the same frame are batched into one IPC call — TDLib's
 *   `getCustomEmojiStickers` takes up to 200 ids, and a post with eight emoji must
 *   not cost eight round-trips;
 * - a failure leaves the base glyph in place and is not cached, so the next mount
 *   asks again.
 */
type StickerArt = CustomEmojiSticker['sticker']
/** Custom emoji ids are TDLib int64 values, so they are strings here too. */
type CustomEmojiId = string

/** TDLib's own cap on one `getCustomEmojiStickers` call. */
export const CUSTOM_EMOJI_BATCH = 200

/** Wait this long before flushing: one frame's worth of new lookups. */
const FLUSH_DELAY_MS = 16

const cache = new Map<CustomEmojiId, StickerArt>()
const waiting = new Map<CustomEmojiId, Array<(sticker: StickerArt | undefined) => void>>()
let queued = new Set<CustomEmojiId>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function cachedCustomEmoji(id: CustomEmojiId): StickerArt | undefined {
  return cache.get(id)
}

export function ensureCustomEmoji(id: CustomEmojiId): Promise<StickerArt | undefined> {
  const cached = cache.get(id)
  if (cached) return Promise.resolve(cached)
  const promise = new Promise<StickerArt | undefined>((resolve) => {
    const listeners = waiting.get(id) ?? []
    listeners.push(resolve)
    waiting.set(id, listeners)
  })
  queued.add(id)
  if (flushTimer === null) flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS)
  return promise
}

/** Splits ids into the largest calls TDLib accepts. */
export function chunkIds(ids: CustomEmojiId[], size = CUSTOM_EMOJI_BATCH): CustomEmojiId[][] {
  const chunks: CustomEmojiId[][] = []
  for (let start = 0; start < ids.length; start += size) chunks.push(ids.slice(start, start + size))
  return chunks
}

async function flush(): Promise<void> {
  flushTimer = null
  const ids = [...queued]
  queued = new Set()
  for (const chunk of chunkIds(ids)) await request(chunk)
  // Lookups that arrived while the request was in flight get their own frame.
  if (queued.size > 0 && flushTimer === null) flushTimer = setTimeout(() => void flush(), 0)
}

async function request(ids: CustomEmojiId[]): Promise<void> {
  // A failed lookup is not an error the reader should see: the entity's own glyph
  // is the fallback. Leave the ids uncached so the next mount asks again.
  const found = await invoke('stickers:customEmoji', { ids })
    .then((answer) => new Map(answer.map((item) => [item.customEmojiId, item.sticker])))
    .catch(() => new Map<CustomEmojiId, StickerArt>())
  for (const id of ids) {
    const sticker = found.get(id)
    if (sticker) cache.set(id, sticker)
    const listeners = waiting.get(id)
    waiting.delete(id)
    for (const resolve of listeners ?? []) resolve(sticker)
  }
}
