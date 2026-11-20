import type { MessageMedia } from '@wegram/protocol'

/** A sticker's on-screen size, in CSS px. */
export interface StickerBox {
  width: number
  height: number
}

/**
 * TDLib reports no dimensions until the sticker's metadata has arrived. The
 * official clients assume a square sticker, which is also the picker's normal
 * cell shape, so a row painted early does not jump when the size lands.
 */
const DEFAULT_STICKER_SIZE = 128

/** A very flat sticker still has to stay visible in a picker cell. */
export const MIN_STICKER_SIZE = 24

/**
 * The box a sticker is drawn into: its own aspect, fitted inside a square bound.
 * Shared by the sticker itself, the premium effect that wraps it, and inline
 * custom emoji, so they can never disagree about where the sticker ends.
 *
 * `min` is for the one caller that draws *below* the picker's floor: a custom
 * emoji sits in a 14 px line of text, not in a 92 px grid cell.
 */
export function stickerBox(
  media: Pick<MessageMedia, 'width' | 'height'>,
  size: number,
  min = MIN_STICKER_SIZE,
): StickerBox {
  const width = media.width ?? DEFAULT_STICKER_SIZE
  const height = media.height ?? DEFAULT_STICKER_SIZE
  const scale = Math.min(size / width, size / height)
  return {
    width: Math.max(min, Math.round(width * scale)),
    height: Math.max(min, Math.round(height * scale)),
  }
}

/**
 * Telegram draws a premium sticker's effect 1.49× the sticker, so its sparks can
 * fly past the artwork — tdesktop's `kPremiumMultiplier = (1 + 0.245 * 2)`, used
 * for a message-history sticker. The effect's canvas is square with the sticker
 * in its centre, so the sticker's longest edge is what the multiplier applies to.
 */
export const PREMIUM_EFFECT_SCALE = 1 + 0.245 * 2

export function premiumEffectBox(sticker: StickerBox): StickerBox {
  const side = Math.round(Math.max(sticker.width, sticker.height) * PREMIUM_EFFECT_SCALE)
  return { width: side, height: side }
}
