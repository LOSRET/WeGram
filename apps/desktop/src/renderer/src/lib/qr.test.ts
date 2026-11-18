import { describe, expect, it } from 'vitest'

import { qrMatrix, qrPath } from './qr'

const LOGIN_LINK = 'tg://login?token=A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'

describe('qrMatrix', () => {
  it('encodes a login link into a square module matrix', () => {
    const matrix = qrMatrix(LOGIN_LINK)
    expect(matrix.size).toBeGreaterThanOrEqual(21)
    // QR versions grow in steps of four modules from 21×21.
    expect((matrix.size - 21) % 4).toBe(0)
    expect(matrix.modules).toHaveLength(matrix.size * matrix.size)
  })

  it('puts a finder pattern in all three corners', () => {
    const { size, modules } = qrMatrix(LOGIN_LINK)
    const dark = (row: number, column: number): boolean => modules[row * size + column] === 1

    for (const [row, column] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      expect(dark(row, column)).toBe(true)
      expect(dark(row + 1, column + 1)).toBe(false)
      expect(dark(row + 3, column + 3)).toBe(true)
    }
  })

  it('grows with the content and rejects empty content', () => {
    expect(qrMatrix(LOGIN_LINK).size).toBeGreaterThanOrEqual(qrMatrix('tg://login').size)
    expect(() => qrMatrix('')).toThrow('QR content is empty')
  })
})

describe('qrPath', () => {
  it('emits exactly one closed subpath per dark module', () => {
    const matrix = qrMatrix(LOGIN_LINK)
    const darkModules = matrix.modules.reduce((total, bit) => total + (bit === 1 ? 1 : 0), 0)
    const path = qrPath(matrix)
    expect(path.startsWith('M')).toBe(true)
    expect((path.match(/z/g) ?? []).length).toBe(darkModules)
  })

  it('is deterministic for the same link', () => {
    expect(qrPath(qrMatrix(LOGIN_LINK))).toBe(qrPath(qrMatrix(LOGIN_LINK)))
  })
})
