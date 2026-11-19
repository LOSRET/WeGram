import { describe, expect, it } from 'vitest'

import { containsText, normalizeQuery } from './search'

describe('normalizeQuery', () => {
  it('trims and case-folds', () => {
    expect(normalizeQuery('  WeGram  ')).toBe('wegram')
    expect(normalizeQuery('   ')).toBe('')
  })
})

describe('containsText', () => {
  it('matches a substring case-insensitively', () => {
    expect(containsText('WeGram 产品群', 'wegram')).toBe(true)
    expect(containsText('前端周会', '周会')).toBe(true)
    expect(containsText('前端周会', '产品')).toBe(false)
  })

  it('never matches an empty needle', () => {
    expect(containsText('anything', '')).toBe(false)
  })
})
