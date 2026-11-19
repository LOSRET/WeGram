import { describe, expect, it } from 'vitest'

import { pageAround, pageNewer, pageOlder } from './paging'

const ALL = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id }))
const ids = (page: { messages: { id: number }[] }): number[] => page.messages.map((m) => m.id)

describe('pageOlder', () => {
  it('serves the newest page without a cursor', () => {
    expect(ids(pageOlder(ALL, undefined, 3))).toEqual([6, 7, 8])
    expect(pageOlder(ALL, undefined, 3).hasMore).toBe(true)
  })

  it('treats the cursor as exclusive', () => {
    expect(ids(pageOlder(ALL, 6, 3))).toEqual([3, 4, 5])
  })

  it('reports the end of history', () => {
    expect(pageOlder(ALL, 3, 5).hasMore).toBe(false)
    expect(pageOlder([], undefined, 5)).toEqual({ messages: [], hasMore: false })
  })
})

describe('pageAround', () => {
  it('centres on the message and keeps the anchor', () => {
    expect(ids(pageAround(ALL, 4, 1))).toEqual([3, 4, 5])
    expect(pageAround(ALL, 4, 1)).toMatchObject({ hasMore: true, hasNewer: true })
  })

  it('anchors on the next message when the id is gone', () => {
    expect(ids(pageAround(ALL, 4.5, 1))).toEqual([4, 5, 6])
  })

  it('stops at both ends', () => {
    expect(pageAround(ALL, 1, 2)).toMatchObject({ hasMore: false })
    expect(pageAround(ALL, 8, 2)).toMatchObject({ hasNewer: false })
  })

  it('answers an empty window past the end', () => {
    expect(pageAround(ALL, 99, 2)).toEqual({ messages: [], hasMore: true, hasNewer: false })
  })
})

describe('pageNewer', () => {
  it('walks forward from an exclusive id', () => {
    expect(ids(pageNewer(ALL, 6, 2))).toEqual([7, 8])
    expect(pageNewer(ALL, 6, 2).hasNewer).toBe(false)
    expect(pageNewer(ALL, 2, 2).hasNewer).toBe(true)
  })
})
