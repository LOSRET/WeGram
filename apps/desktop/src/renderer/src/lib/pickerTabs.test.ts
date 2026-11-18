import { describe, expect, it } from 'vitest'

import { tabPaging } from './pickerTabs'

describe('tabPaging', () => {
  it('keeps all seven sets visible without an arrow', () => {
    // 搜索 + 表情 + 7 sets = the strip's nine slots.
    expect(tabPaging(7)).toEqual({ paged: false, pageSize: 7, pageCount: 1 })
  })

  it('reserves a slot for 下一页 and pages six sets at a time', () => {
    // 搜索 + 表情 + 6 sets + 下一页 = nine slots; the seventh set moves to page 2.
    expect(tabPaging(8)).toEqual({ paged: true, pageSize: 6, pageCount: 2 })
    expect(tabPaging(12)).toEqual({ paged: true, pageSize: 6, pageCount: 2 })
    expect(tabPaging(13)).toEqual({ paged: true, pageSize: 6, pageCount: 3 })
  })

  it('handles an account with no sticker sets', () => {
    expect(tabPaging(0)).toEqual({ paged: false, pageSize: 0, pageCount: 1 })
  })
})
