import type { MediaSize } from '@wegram/protocol'

/** A box in device pixels: CSS pixels × devicePixelRatio. */
export interface MediaTarget {
  width: number
  height: number
}

/**
 * The variant a box of `target` device pixels should download.
 *
 * The official client asks for the smallest size that still covers what it is
 * about to draw, never the original: a 240 px bubble on a 100 % display wants the
 * 320 px variant, which is a few times less data than the 1280 px one and
 * arrives while the reader is still scrolling. `sizes` is smallest-first, as
 * the mapper emits it.
 *
 * Answers `undefined` when TDLib sent no size table (a video, a file), and falls
 * back to the largest variant when nothing is big enough — a tiny source picture
 * must still be shown rather than refused.
 */
export function pickVariant(
  sizes: readonly MediaSize[] | undefined,
  target: MediaTarget,
): MediaSize | undefined {
  if (!sizes || sizes.length === 0) return undefined
  const width = Math.max(1, Math.round(target.width))
  const height = Math.max(1, Math.round(target.height))
  for (const size of sizes) {
    if (size.width >= width && size.height >= height) return size
  }
  return sizes[sizes.length - 1]
}
