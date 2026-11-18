/**
 * Paging for the expression picker's bottom strip.
 *
 * The client's strip is a window over the whole tab row (搜索, 表情, then every
 * installed sticker set), not a fixed set of tabs with a cursor: paging all the
 * way right scrolls 搜索/表情 off, and the window is clamped to the end. A 44 px
 * slot holds either a tab or one of the arrows, so a first/last window shows
 * **eight tabs and one arrow**, while a middle window shows **seven tabs
 * between two arrows** — nine slots in every case.
 *
 * Slots: 9 (44 px tabs, 5 px gaps, 14 px inset inside the 464 px card).
 */

export const PICKER_TAB_SLOTS = 9

export interface StripWindow {
  /** Index of the first tab shown. */
  start: number
  /** Tabs shown in this window. */
  count: number
  hasLeft: boolean
  hasRight: boolean
  /** Total number of pages; a page outside this range is clamped. */
  pageCount: number
}

export function stripWindow(total: number, page: number, slots = PICKER_TAB_SLOTS): StripWindow {
  if (total <= slots) {
    return { start: 0, count: total, hasLeft: false, hasRight: false, pageCount: 1 }
  }
  // A window at either end has one arrow; a middle window has two.
  const edge = slots - 1
  const middle = slots - 2
  const pageCount = 2 + Math.ceil(Math.max(0, total - 2 * edge) / middle)
  const current = Math.min(Math.max(page, 0), pageCount - 1)
  // Page 0 starts at the row's beginning; every later window steps by its
  // previous middle capacity, and the last window is clamped to the end so it
  // shows a full row to the right of 上一页.
  const start =
    current === 0 ? 0 : Math.min(edge + (current - 1) * middle, total - edge)
  const remaining = total - start
  const count = remaining <= edge ? remaining : current === 0 ? edge : middle
  return {
    start,
    count,
    hasLeft: start > 0,
    hasRight: start + count < total,
    pageCount,
  }
}

/**
 * The smallest page whose window contains an index; used when a search result
 * opens a sticker set that current paging has scrolled away.
 */
export function pageForIndex(total: number, index: number, slots = PICKER_TAB_SLOTS): number {
  if (index < 0 || index >= total) return 0
  const { pageCount } = stripWindow(total, 0, slots)
  for (let page = 0; page < pageCount; page += 1) {
    const window = stripWindow(total, page, slots)
    if (index >= window.start && index < window.start + window.count) return page
  }
  return 0
}
