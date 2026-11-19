/**
 * Where a floating card lands, given its measured size.
 *
 * Six call sites used to translate "right-aligned under that button" into
 * absolute pixel arithmetic (`rect.right - 232`, `rect.top - 92`), with the
 * constants matching no stylesheet value. The rule belongs in one testable
 * place; the callers now say what they mean.
 */

/** A rectangle in viewport coordinates — exactly what getBoundingClientRect returns. */
export interface PopupAnchor {
  left: number
  right: number
  top: number
  bottom: number
}

export interface PopupPlacement {
  /** Which side of the anchor the card hangs on. Default: below. */
  side?: 'below' | 'above'
  /** Horizontal edge alignment. Default: left. */
  align?: 'left' | 'center' | 'right'
  /** Pixels between the card and the anchor. Default: 6. */
  gap?: number
}

export interface PopupSize {
  width: number
  height: number
}

export interface PopupViewport {
  width: number
  height: number
}

export interface PopupPosition {
  left: number
  top: number
}

/** Gap between a card and the window edge. */
export const POPUP_EDGE = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** A card opened at a point (a mouse event, a fixed spot). */
export function placeAtPoint(
  point: { x: number; y: number },
  size: PopupSize,
  options: { centerX: boolean },
  viewport: PopupViewport,
): PopupPosition {
  const wanted = options.centerX ? point.x - size.width / 2 : point.x
  return {
    left: clamp(wanted, POPUP_EDGE, viewport.width - size.width - POPUP_EDGE),
    top:
      point.y + size.height > viewport.height - POPUP_EDGE
        ? Math.max(POPUP_EDGE, point.y - size.height)
        : Math.min(point.y, viewport.height - size.height - POPUP_EDGE),
  }
}

/**
 * A card opened against an element's rectangle (a button that owns a menu).
 *
 * A card that does not fit on its requested side flips to the other one before
 * it is clamped: clamping alone slides it over the button it belongs to.
 */
export function placeAgainstAnchor(
  anchor: PopupAnchor,
  size: PopupSize,
  placement: PopupPlacement,
  viewport: PopupViewport,
): PopupPosition {
  const gap = placement.gap ?? 6
  const align = placement.align ?? 'left'
  const side = placement.side ?? 'below'

  const left =
    align === 'right'
      ? anchor.right - size.width
      : align === 'center'
        ? (anchor.left + anchor.right - size.width) / 2
        : anchor.left

  let top = side === 'above' ? anchor.top - gap - size.height : anchor.bottom + gap
  if (side === 'below' && top + size.height > viewport.height - POPUP_EDGE) {
    top = anchor.top - gap - size.height
  } else if (side === 'above' && top < POPUP_EDGE) {
    top = anchor.bottom + gap
  }

  return {
    left: clamp(left, POPUP_EDGE, viewport.width - size.width - POPUP_EDGE),
    top: clamp(top, POPUP_EDGE, viewport.height - size.height - POPUP_EDGE),
  }
}

/** Copies the four edges out of a DOMRect. */
export function anchorOf(rect: {
  left: number
  right: number
  top: number
  bottom: number
}): PopupAnchor {
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
}
