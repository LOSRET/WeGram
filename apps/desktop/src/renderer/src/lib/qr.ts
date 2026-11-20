import { create } from 'qrcode'

/**
 * QR login codes (design doc §9.6).
 *
 * TDLib hands the login window a `tg://login?token=…` link that it re-issues
 * every few seconds. The `qrcode` package does the encoding; this module
 * normalises the bit matrix, turns it into one SVG path and frames it with the
 * quiet zone a scanner needs, so the React side stays a dumb component and the
 * geometry is unit-tested.
 */
export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. */
  size: number
  /** Row-major module bits; 1 = dark. */
  modules: Uint8Array
}

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'

/**
 * The white margin a QR code cannot be read without: four modules on every
 * side. The login sheet is `#fafafa` (dark theme `#1e1e1f`), so borrowing the
 * page as the quiet zone gave the code none at all and phone cameras could not
 * lock onto the symbol.
 */
export const QR_QUIET_ZONE = 4

export function qrMatrix(content: string, errorCorrectionLevel: QrErrorCorrection = 'M'): QrMatrix {
  if (!content) throw new Error('QR content is empty')
  const { modules } = create(content, { errorCorrectionLevel })
  return { size: modules.size, modules: Uint8Array.from(modules.data) }
}

/**
 * One `M…h1v1h-1z` subpath per dark module. A 136 px login code is ~1200 dark
 * modules; as one path it stays a single SVG element instead of ~1200 <rect>s.
 * `offset` shifts every module by that many module units — the quiet zone.
 */
export function qrPath(matrix: QrMatrix, offset = 0): string {
  const parts: string[] = []
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.modules[row * matrix.size + column] === 1) {
        parts.push(`M${column + offset} ${row + offset}h1v1h-1z`)
      }
    }
  }
  return parts.join('')
}

export interface QrDrawing {
  /** Side of the drawn square in module units, quiet zone included. */
  box: number
  /** Offset of the first module inside that square, in module units. */
  quietZone: number
  /** The dark modules as one path, already offset into the padded square. */
  path: string
}

/**
 * The whole square to draw: the module grid inset by its quiet zone. The caller
 * paints the full `box` white, so the margin travels with the code instead of
 * depending on the page behind it.
 */
export function qrDrawing(matrix: QrMatrix, quietZone: number = QR_QUIET_ZONE): QrDrawing {
  const zone = Math.max(0, Math.floor(quietZone))
  return { box: matrix.size + zone * 2, quietZone: zone, path: qrPath(matrix, zone) }
}
