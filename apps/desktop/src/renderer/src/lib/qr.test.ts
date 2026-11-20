import { describe, expect, it } from 'vitest'

import { qrDrawing, qrMatrix, qrPath, QR_QUIET_ZONE } from './qr'

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

describe('qrDrawing', () => {
  it('frames the module grid with the four-module quiet zone', () => {
    const matrix = qrMatrix(LOGIN_LINK)
    const drawing = qrDrawing(matrix)
    expect(drawing.quietZone).toBe(QR_QUIET_ZONE)
    expect(QR_QUIET_ZONE).toBe(4)
    expect(drawing.box).toBe(matrix.size + QR_QUIET_ZONE * 2)
  })

  it('keeps every dark module inside the padding', () => {
    const drawing = qrDrawing(qrMatrix(LOGIN_LINK))
    const modules = [...drawing.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((match) => ({
      column: Number(match[1]),
      row: Number(match[2]),
    }))
    expect(modules.length).toBeGreaterThan(0)
    const limit = drawing.box - 1
    for (const { column, row } of modules) {
      expect(column).toBeGreaterThanOrEqual(QR_QUIET_ZONE)
      expect(row).toBeGreaterThanOrEqual(QR_QUIET_ZONE)
      expect(column).toBeLessThanOrEqual(limit - QR_QUIET_ZONE)
      expect(row).toBeLessThanOrEqual(limit - QR_QUIET_ZONE)
    }
  })

  it('leaves the unpadded path untouched', () => {
    expect(qrPath(qrMatrix(LOGIN_LINK), 0)).toBe(qrPath(qrMatrix(LOGIN_LINK)))
  })
})
