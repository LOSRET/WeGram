/**
 * Paging for the expression picker's bottom strip.
 *
 * The client's strip is a window over the whole tab row (搜索, 表情, then every
 * installed sticker set), not a fixed set of tabs with a cursor: paging all the
 * way right scrolls 搜索/表情 off, and the window is clamped to the end. A 44 px
 * slot holds either a tab or one of the arrows, so a paging window shows eight
 * tabs on the first/last page and seven between two arrows.
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
  // One slot is always reserved for an arrow, and the step leaves room for the
  // second arrow on a middle page.
  const capacity = slots - 1
  const step = capacity - 1
  const lastPage = Math.ceil((total - capacity) / step)
  const current = Math.min(Math.max(page, 0), lastPage)
  // Clamp the last page to the end instead of leaving it half empty; this is
  // what makes the final window show a full row to the right of 上一页.
  const start = Math.min(current * step, total - capacity)
  return {
    start,
    count: Math.min(capacity, total - start),
    hasLeft: start > 0,
    hasRight: start + capacity < total,
    pageCount: lastPage + 1,
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
