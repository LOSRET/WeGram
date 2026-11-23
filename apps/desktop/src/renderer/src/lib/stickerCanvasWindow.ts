/**
 * How far ahead a shared sticker canvas parses, and how far away it lets go.
 *
 * A panel's grid spans a whole pack — a 120-sticker pack in the box is ~2 000 px
 * tall — so parsing what the reader is about to reach is the only way a row can be
 * animated the moment it appears. Cells inside the load band are parsed; cells
 * outside the drop band are released, but not before the layer saves their last
 * painted frame (Telegram Desktop's `savedFrame`), so coming back shows that still
 * image instead of flashing the thumbnail while the animation is parsed again.
 *
 * The drop band is one screen wider than the load band on each side: a cell that
 * only just left the load band stays parsed (paused), and releasing it is a
 * hysteresis step, not a per-frame decision.
 *
 * Measured against a scroller's own coordinates (its `scrollTop`), never the
 * window: a cell clipped out of a panel is not visible even when the window still
 * contains its rect.
 */

/** A vertical band, in the scroller's content coordinates. */
export interface Band {
  from: number
  to: number
}

export interface StickerWindow {
  /** Cells overlapping this band are parsed and added to the canvas. */
  load: Band
  /** Cells outside this band are released, after their last frame is saved. */
  drop: Band
}

/**
 * Two screens each way: a Lottie parse costs 1–3 ms of main thread, and parsing
 * that far ahead means a row is ready before the reader's eye reaches it. Parsing
 * itself waits for the scroll to settle, so the distance is about preparation,
 * never about work during a scroll frame.
 */
export const LOAD_SCREENS = 2
/** One screen of hysteresis past the load band; a released cell keeps its still frame. */
export const DROP_SCREENS = 3

export function stickerWindow(
  scrollTop: number,
  height: number,
  loadScreens = LOAD_SCREENS,
  dropScreens = DROP_SCREENS,
): StickerWindow {
  // A collapsed panel reports 0 px; the bands must still be a usable width.
  const screen = Math.max(1, height)
  return {
    load: { from: scrollTop - screen * loadScreens, to: scrollTop + screen * (loadScreens + 1) },
    drop: { from: scrollTop - screen * dropScreens, to: scrollTop + screen * (dropScreens + 1) },
  }
}

/**
 * Whether a cell overlaps a band. Overlap, not containment: a half-visible row is
 * still worth its parse.
 */
export function overlaps(band: Band, top: number, bottom: number): boolean {
  return bottom > band.from && top < band.to
}
