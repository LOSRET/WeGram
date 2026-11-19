export interface MediaBox {
  width: number
  height: number
}

/**
 * The box a bubble reserves before the file arrives (design doc §8.2 rule 4).
 *
 * The height is part of the scroll contract: a bubble that grows when its photo
 * loads moves the anchored row. Photos and videos had the same maths with two
 * different fallback ratios; the ratio is the only thing they disagree on, so it
 * is the only thing the caller passes.
 */
export function reserveBox(
  media: { width?: number; height?: number },
  options: {
    maxWidth: number
    maxHeight: number
    /** Used when TDLib gave no dimensions (a bare photo or video object). */
    fallbackWidth: number
    fallbackHeight: number
  },
): MediaBox {
  const width = media.width ?? options.fallbackWidth
  const height = media.height ?? options.fallbackHeight
  const scale = Math.min(options.maxWidth / width, options.maxHeight / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** A 0..1 progress ratio as the text every bubble and the viewer shows. */
export function percentOf(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
