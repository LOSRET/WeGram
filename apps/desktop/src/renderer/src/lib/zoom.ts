/**
 * Geometry for the standalone image viewer (design doc §9.5).
 *
 * The window shows the photo at "fit" by default and switches to an explicit
 * scale once the reader zooms, so every rule about *how large* the picture is
 * lives here and is unit-tested: the component only renders what these functions
 * return.
 */

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** Zoom is relative to the photo's own pixel size (1 = 图片原始大小). */
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 8
export const ZOOM_STEP = 1.25

/** Rotation is normalised to 0/90/180/270 so a quarter turn is detectable. */
export function normaliseRotation(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360
  return (Math.round(wrapped / 90) * 90) % 360
}

/** True when the rotation swaps the photo's width and height on screen. */
export function isQuarterTurn(rotation: number): boolean {
  return normaliseRotation(rotation) === 90 || normaliseRotation(rotation) === 270
}

/**
 * The scale at which the (rotated) photo fits inside the canvas.
 *
 * `natural` is the photo's size in CSS px, i.e. its pixels divided by the
 * display scale factor, so zoom 1 really is "actual pixels".
 */
export function fitScale(natural: Size | null, canvas: Size, rotation = 0): number {
  if (!natural || natural.width <= 0 || natural.height <= 0) return 1
  if (canvas.width <= 0 || canvas.height <= 0) return 1
  const wide = isQuarterTurn(rotation) ? natural.height : natural.width
  const tall = isQuarterTurn(rotation) ? natural.width : natural.height
  return Math.min(canvas.width / wide, canvas.height / tall)
}

/** The <img> box before its CSS rotation is applied. */
export function elementSize(natural: Size, scale: number): Size {
  return { width: natural.width * scale, height: natural.height * scale }
}

/** The box the photo actually covers once the rotation is applied. */
export function rotatedSize(natural: Size, scale: number, rotation: number): Size {
  const size = elementSize(natural, scale)
  return isQuarterTurn(rotation) ? { width: size.height, height: size.width } : size
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function stepZoom(current: number, direction: 1 | -1): number {
  return clampZoom(current * (direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
}

/**
 * Keeps the photo reachable: it may be dragged until one of its edges meets the
 * canvas edge, never further. A photo smaller than the canvas cannot be dragged.
 */
export function clampPan(pan: Point, photo: Size, canvas: Size): Point {
  const slackX = Math.max(0, (photo.width - canvas.width) / 2)
  const slackY = Math.max(0, (photo.height - canvas.height) / 2)
  return {
    x: Math.min(slackX, Math.max(-slackX, pan.x)),
    y: Math.min(slackY, Math.max(-slackY, pan.y)),
  }
}

/** Toolbar label: the photo's own size in percent, like the client's zoom readout. */
export function zoomPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`
}
