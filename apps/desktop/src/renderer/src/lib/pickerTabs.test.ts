import { describe, expect, it } from 'vitest'

import { pageForIndex, stripWindow } from './pickerTabs'

describe('stripWindow', () => {
  it('shows every tab when the row fits, with no arrows', () => {
    expect(stripWindow(8, 0)).toEqual({
      start: 0,
      count: 8,
      hasLeft: false,
      hasRight: false,
      pageCount: 1,
    })
    expect(stripWindow(9, 0).count).toBe(9)
  })

  it('puts 下一页 on the first page and 上一页 on the last one', () => {
    // 搜索 + 表情 + 8 sets = 10 tabs. The first window shows eight tabs plus 下一页;
    // the second window is clamped to the end: 上一页 plus the last eight tabs.
    expect(stripWindow(10, 0)).toEqual({
      start: 0,
      count: 8,
      hasLeft: false,
      hasRight: true,
      pageCount: 2,
    })
    expect(stripWindow(10, 1)).toEqual({
      start: 2,
      count: 8,
      hasLeft: true,
      hasRight: false,
      pageCount: 2,
    })
  })

  it('shows seven tabs between two arrows on a middle page', () => {
    // 2 fixed + 16 sets = 18 tabs -> three windows: 0..7, 8..14, 10..17.
    // The middle window must reserve one slot for EACH arrow: eight tabs plus
    // two arrows would be ten slots and clip 下一页 outside the strip.
    expect(stripWindow(18, 1)).toEqual({
      start: 8,
      count: 7,
      hasLeft: true,
      hasRight: true,
      pageCount: 3,
    })
    expect(stripWindow(18, 2)).toEqual({
      start: 10,
      count: 8,
      hasLeft: true,
      hasRight: false,
      pageCount: 3,
    })
  })

  it('keeps a two-page row to a single edge arrow at each end', () => {
    // 14 sets + the two fixed tabs: first 8 tabs, then 上一页 + the last 8.
    expect(stripWindow(16, 0)).toMatchObject({ start: 0, count: 8, hasRight: true })
    expect(stripWindow(16, 1)).toMatchObject({ start: 8, count: 8, hasLeft: true, hasRight: false })
  })

  it('never offers a right arrow past the final window', () => {
    for (let total = 10; total < 40; total += 1) {
      const last = stripWindow(total, 999)
      expect(last.hasRight).toBe(false)
      expect(last.start + last.count).toBe(total)
    }
  })

  it('clamps an out-of-range page into the row', () => {
    expect(stripWindow(10, 99)).toEqual(stripWindow(10, 1))
    expect(stripWindow(10, -3)).toEqual(stripWindow(10, 0))
  })
})

describe('pageForIndex', () => {
  it('finds the window that contains a scrolled-off set', () => {
    expect(pageForIndex(18, 0)).toBe(0)
    expect(pageForIndex(18, 7)).toBe(0)
    expect(pageForIndex(18, 8)).toBe(1)
    expect(pageForIndex(18, 17)).toBe(2)
  })

  it('falls back to the first page for an index that does not exist', () => {
    expect(pageForIndex(10, 99)).toBe(0)
    expect(pageForIndex(10, -1)).toBe(0)
  })
})
