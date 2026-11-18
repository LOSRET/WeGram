import { create } from 'qrcode'

/**
 * QR login codes (design doc §9.6).
 *
 * TDLib hands the login window a `tg://login?token=…` link that it re-issues
 * every few seconds. The `qrcode` package does the encoding; this module only
 * normalises the bit matrix and turns it into one SVG path, so the React side
 * stays a dumb component and the geometry is unit-tested.
 */
export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. */
  size: number
  /** Row-major module bits; 1 = dark. */
  modules: Uint8Array
}

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'

export function qrMatrix(content: string, errorCorrectionLevel: QrErrorCorrection = 'M'): QrMatrix {
  if (!content) throw new Error('QR content is empty')
  const { modules } = create(content, { errorCorrectionLevel })
  return { size: modules.size, modules: Uint8Array.from(modules.data) }
}

/**
 * One `M…h1v1h-1z` subpath per dark module. A 136 px login code is ~1200 dark
 * modules; as one path it stays a single SVG element instead of ~1200 <rect>s.
 */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = []
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.modules[row * matrix.size + column] === 1) {
        parts.push(`M${column} ${row}h1v1h-1z`)
      }
    }
  }
  return parts.join('')
}
