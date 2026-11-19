import { registerMediaFile } from '../../../media/registry'
import type { TdObject } from '../client'

/**
 * Shared by the message mapper (`mapContent`) and the rich-message mapper:
 * both read a TDLib media object and need the `wx-media://` URL of a file that
 * is already on disk. The renderer never sees the path itself — only adapters
 * may register one (media/registry).
 */
export function mediaUrls(
  file: TdObject | undefined,
  thumb?: TdObject | undefined,
): { localUrl?: string; thumbUrl?: string } {
  const localUrl = localUrlOf(file)
  const thumbUrl = localUrlOf(thumb)
  return {
    ...(localUrl ? { localUrl } : {}),
    ...(thumbUrl ? { thumbUrl } : {}),
  }
}

function localUrlOf(file: TdObject | undefined): string | undefined {
  const local = file?.local
  if (!local?.is_downloading_completed) return undefined
  if (typeof local.path !== 'string' || local.path.length === 0) return undefined
  return registerMediaFile(local.path)
}

export function pickLargest(sizes: TdObject[]): TdObject | undefined {
  return sizes.reduce<TdObject | undefined>((best, size) => {
    if (!best) return size
    const area = (size.width ?? 0) * (size.height ?? 0)
    const bestArea = (best.width ?? 0) * (best.height ?? 0)
    return area > bestArea ? size : best
  }, undefined)
}

export function pickSmallestAtLeast(sizes: TdObject[], minWidth: number): TdObject | undefined {
  return [...sizes]
    .filter((size) => (size.width ?? 0) >= minWidth)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0]
}
