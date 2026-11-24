import { describe, expect, it } from 'vitest'

import {
  ALBUM_MAX_WIDTH,
  ALBUM_SPACING,
  albumItemSize,
  layoutAlbum,
  resizeAlbum,
} from './albumLayout'
import type { AlbumCell, AlbumLayout } from './albumLayout'

const photo = (width: number, height: number) => ({ width, height })

/** Cells grouped by their top edge: one group per row of the composition. */
function rows(layout: AlbumLayout): AlbumCell[][] {
  const byTop = new Map<number, AlbumCell[]>()
  for (const cell of layout.cells) {
    const row = byTop.get(cell.y) ?? []
    row.push(cell)
    byTop.set(cell.y, row)
  }
  return [...byTop.entries()]
    .sort(([first], [second]) => first - second)
    .map(([, row]) => [...row].sort((a, b) => a.x - b.x))
}

function overlaps(first: AlbumCell, second: AlbumCell): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  )
}

function expectWellFormed(layout: AlbumLayout, count: number): void {
  expect(layout.cells).toHaveLength(count)
  for (const cell of layout.cells) {
    expect(cell.width).toBeGreaterThan(0)
    expect(cell.height).toBeGreaterThan(0)
    expect(cell.x).toBeGreaterThanOrEqual(0)
    expect(cell.y).toBeGreaterThanOrEqual(0)
    expect(cell.x + cell.width).toBeLessThanOrEqual(layout.width)
    expect(cell.y + cell.height).toBeLessThanOrEqual(layout.height)
    expect(layout.width).toBeLessThanOrEqual(ALBUM_MAX_WIDTH)
  }
  for (let first = 0; first < layout.cells.length; first += 1) {
    for (let second = first + 1; second < layout.cells.length; second += 1) {
      const a = layout.cells[first]
      const b = layout.cells[second]
      if (!a || !b) continue
      expect(overlaps(a, b)).toBe(false)
    }
  }
}

describe('layoutAlbum', () => {
  it('places one item at the album width and its own ratio', () => {
    const layout = layoutAlbum([photo(1000, 500)])
    expect(layout.width).toBe(ALBUM_MAX_WIDTH)
    expect(layout.height).toBe(215)
    expect(layout.cells[0]?.sides).toEqual({ left: true, top: true, right: true, bottom: true })
  })

  it('puts two square pictures in two equal columns', () => {
    const layout = layoutAlbum([photo(100, 100), photo(100, 100)])
    expect(layout.width).toBe(430)
    expect(layout.height).toBe(213)
    expect(layout.cells.map((cell) => [cell.x, cell.y, cell.width, cell.height])).toEqual([
      [0, 0, 213, 213],
      [217, 0, 213, 213],
    ])
    // Only the outer frame is rounded: the seam between the two is square.
    expect(layout.cells[0]?.sides.right).toBe(false)
    expect(layout.cells[1]?.sides.left).toBe(false)
  })

  it('stacks two similar panoramas instead of squeezing two columns', () => {
    const layout = layoutAlbum([photo(1600, 900), photo(1600, 900)])
    expect(layout.width).toBe(430)
    expect(layout.height).toBe(430)
    expect(layout.cells.map((cell) => [cell.x, cell.y, cell.width, cell.height])).toEqual([
      [0, 0, 430, 213],
      [0, 217, 430, 213],
    ])
  })

  it('gives a tall first picture the left column of three', () => {
    const layout = layoutAlbum([photo(600, 900), photo(900, 600), photo(900, 600)])
    expectWellFormed(layout, 3)
    const [left, rightTop, rightBottom] = layout.cells
    expect(left?.height).toBe(430)
    expect(rightTop?.x).toBe(217)
    expect(rightBottom?.y).toBe(217)
    expect(rightTop?.width).toBe(rightBottom?.width)
  })

  it('stacks a wide first picture above two of three', () => {
    const layout = layoutAlbum([photo(900, 600), photo(900, 600), photo(900, 600)])
    expectWellFormed(layout, 3)
    const [top, bottomLeft, bottomRight] = layout.cells
    expect(top?.width).toBe(430)
    expect(top?.height).toBe(281)
    expect(bottomLeft?.y).toBe(285)
    expect(bottomRight?.x).toBe(217)
  })

  it('draws four pictures as one top row and three below', () => {
    const layout = layoutAlbum([
      photo(1600, 900),
      photo(1000, 1000),
      photo(1000, 1000),
      photo(1000, 1000),
    ])
    expectWellFormed(layout, 4)
    expect(layout.cells[0]?.width).toBe(430)
    const bottom = rows(layout)[1] ?? []
    expect(bottom).toHaveLength(3)
    expect(bottom[0]?.x).toBe(0)
    expect((bottom[2]?.x ?? 0) + (bottom[2]?.width ?? 0)).toBe(430)
  })

  it('draws four pictures as one left column and three rows', () => {
    const layout = layoutAlbum([
      photo(600, 900),
      photo(1000, 1000),
      photo(1000, 1000),
      photo(1000, 1000),
    ])
    expectWellFormed(layout, 4)
    expect(layout.cells[0]?.height).toBe(430)
    const right = layout.cells.slice(1)
    expect(right.every((cell) => cell.x === 260)).toBe(true)
    // Three rows on the right, the first sharing its top edge with the column.
    expect(right.map((cell) => cell.y)).toEqual([0, 145, 290])
    expect(right.map((cell) => cell.height)).toEqual([141, 141, 140])
  })

  it('fills every row of a five-to-ten item album edge to edge', () => {
    const ratios = [
      photo(1200, 800),
      photo(800, 1200),
      photo(1000, 1000),
      photo(1600, 900),
      photo(700, 1200),
      photo(1200, 1200),
      photo(900, 1600),
      photo(1400, 900),
      photo(1000, 1400),
      photo(800, 800),
    ]
    for (let count = 5; count <= ratios.length; count += 1) {
      const layout = layoutAlbum(ratios.slice(0, count))
      expectWellFormed(layout, count)
      const packed = rows(layout)
      // The search's invariant: every row is exactly as wide as the album.
      for (const row of packed) {
        const packedWidth =
          row.reduce((sum, cell) => sum + cell.width, 0) + ALBUM_SPACING * (row.length - 1)
        expect(packedWidth).toBe(ALBUM_MAX_WIDTH)
      }
      expect(packed.length).toBeGreaterThanOrEqual(2)
      expect(packed.length).toBeLessThanOrEqual(4)
    }
  })

  it('sends any picture wider than 2:1 to the split search, even in a pair', () => {
    const layout = layoutAlbum([photo(3000, 1000), photo(400, 300)])
    expectWellFormed(layout, 2)
    // The 3:1 picture takes a full-width row instead of a squashed column.
    expect(layout.cells[0]?.width).toBe(430)
    expect(layout.cells[1]?.y).toBe((layout.cells[0]?.height ?? 0) + ALBUM_SPACING)
  })

  it('is deterministic and independent of the previous album', () => {
    const sizes = [photo(1200, 800), photo(800, 1200), photo(1000, 1000)]
    expect(layoutAlbum(sizes)).toEqual(layoutAlbum(sizes))
  })

  it('keeps an empty album empty', () => {
    expect(layoutAlbum([])).toEqual({ width: 0, height: 0, cells: [] })
  })

  it('takes a custom album width', () => {
    const layout = layoutAlbum([photo(100, 100), photo(100, 100)], { maxWidth: 101, spacing: 1 })
    expect(layout.width).toBe(101)
    expect(layout.cells[0]?.width).toBe(50)
    expect(layout.cells[1]?.x).toBe(51)
  })
})

describe('resizeAlbum', () => {
  it('scales a composition proportionally, seams included', () => {
    const layout = layoutAlbum([photo(1200, 800), photo(800, 1200)])
    expect([layout.width, layout.height]).toEqual([430, 171])

    const scaled = resizeAlbum(layout, 300)
    expect(scaled.width).toBe(300)
    expect(scaled.height).toBe(119)
    expect(scaled.cells.map((cell) => [cell.x, cell.y, cell.width, cell.height])).toEqual([
      [0, 0, 178, 119],
      [181, 0, 119, 119],
    ])
    // The seam shrank with everything else (4 px at 430 → 3 px at 300).
    expect(scaled.cells[1]?.x).toBe((scaled.cells[0]?.width ?? 0) + 3)
  })

  it('leaves a composition that already fits alone', () => {
    const layout = layoutAlbum([photo(1200, 800), photo(800, 1200)])
    expect(resizeAlbum(layout, 430)).toEqual(layout)
    expect(resizeAlbum(layout, 600)).toEqual(layout)
  })

  it('empties an album resized to nothing', () => {
    expect(resizeAlbum(layoutAlbum([photo(100, 100)]), 0)).toEqual({
      width: 0,
      height: 0,
      cells: [],
    })
  })

  it('keeps every scaled cell inside the scaled box', () => {
    const sizes = [
      photo(1200, 800),
      photo(800, 1200),
      photo(1000, 1000),
      photo(1600, 900),
      photo(700, 1200),
      photo(1200, 1200),
    ]
    for (const width of [120, 200, 300, 373]) {
      const scaled = resizeAlbum(layoutAlbum(sizes), width)
      expectWellFormed(scaled, sizes.length)
      expect(scaled.width).toBe(width)
    }
  })
})

describe('albumItemSize', () => {
  it('uses the dimensions TDLib sent', () => {
    expect(
      albumItemSize({ kind: 'photo', media: { fileId: 1, width: 1280, height: 720 } }),
    ).toEqual({
      width: 1280,
      height: 720,
    })
  })

  it('falls back to 4:3 for a photo and 16:9 for a video without dimensions', () => {
    expect(albumItemSize({ kind: 'photo', media: { fileId: 1 } })).toEqual({
      width: 133,
      height: 100,
    })
    expect(albumItemSize({ kind: 'video', media: { fileId: 1 } })).toEqual({
      width: 178,
      height: 100,
    })
    expect(albumItemSize({ kind: 'photo' })).toEqual({ width: 133, height: 100 })
  })
})
