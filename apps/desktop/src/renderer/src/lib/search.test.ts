import { describe, expect, it } from 'vitest'

import { containsText, matchSegments, normalizeQuery } from './search'

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

describe('matchSegments', () => {
  it('marks every occurrence and keeps the original casing', () => {
    expect(matchSegments('WeGram 产品群 wegram', 'wegram')).toEqual([
      { text: 'WeGram', hit: true },
      { text: ' 产品群 ', hit: false },
      { text: 'wegram', hit: true },
    ])
  })

  it('answers one plain segment when nothing matches', () => {
    expect(matchSegments('前端周会', '产品')).toEqual([{ text: '前端周会', hit: false }])
  })

  it('treats an empty needle as no query', () => {
    expect(matchSegments('前端周会', '')).toEqual([{ text: '前端周会', hit: false }])
  })
})
