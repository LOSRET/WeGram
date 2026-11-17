/**
 * Window geometry for the standalone image viewer (design doc §9.5).
 *
 * Measured off the client: its viewer opened at 1147 × 774 CSS px on a
 * 1536 × 864 display, i.e. **75 % of the screen width and 90 % of the screen
 * height**, centred in the work area — independent of the photo's own size (the
 * reference window showed a 591 px-wide picture with wide gutters on both
 * sides). Everything is clamped to the work area so the window never hides under
 * the taskbar.
 */

export interface ViewerSizeInput {
  /** Full display size in CSS px (not the work area). */
  screen: { width: number; height: number }
  /** Usable area, for the clamp. */
  workArea: { width: number; height: number }
}

export interface ViewerSize {
  width: number
  height: number
}

/** Below this the measured toolbar (pin … 保存, 更多, native controls) clips. */
export const VIEWER_MIN_W = 720
export const VIEWER_MIN_H = 420

const WIDTH_RATIO = 0.75
const HEIGHT_RATIO = 0.9
const MARGIN = 8

export function viewerWindowSize({ screen, workArea }: ViewerSizeInput): ViewerSize {
  const width = Math.round(screen.width * WIDTH_RATIO)
  const height = Math.round(screen.height * HEIGHT_RATIO)
  return {
    width: Math.max(VIEWER_MIN_W, Math.min(width, workArea.width - MARGIN * 2)),
    height: Math.max(VIEWER_MIN_H, Math.min(height, workArea.height - MARGIN * 2)),
  }
}
