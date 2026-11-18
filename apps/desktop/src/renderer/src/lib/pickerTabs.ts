/**
 * Paging for the expression picker's bottom strip.
 *
 * The client fits nine 44 px tabs in the 464 px strip (14 px inset, 5 px gaps).
 * 搜索 and 表情 always take two slots, and the 下一页 arrow takes one more, so an
 * overflowing strip pages six sticker sets at a time — the off-by-one this
 * helper exists to keep straight.
 */

export const PICKER_TAB_SLOTS = 9
const FIXED_TABS = 2

export interface TabPaging {
  /** True when the sets do not fit and 下一页 is shown. */
  paged: boolean
  /** Sets visible per page (0 when there are none). */
  pageSize: number
  /** At least 1, so the arrow can wrap without dividing by zero. */
  pageCount: number
}

export function tabPaging(setCount: number): TabPaging {
  const paged = setCount > PICKER_TAB_SLOTS - FIXED_TABS
  const pageSize = paged ? PICKER_TAB_SLOTS - FIXED_TABS - 1 : setCount
  return { paged, pageSize, pageCount: pageSize > 0 ? Math.ceil(setCount / pageSize) : 1 }
}
