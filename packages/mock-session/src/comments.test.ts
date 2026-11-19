import { describe, expect, it } from 'vitest'

import { composeCommentAccess, threadInteraction } from './comments'

describe('composeCommentAccess', () => {
  it('defaults to a joined, writable group', () => {
    expect(composeCommentAccess()).toEqual({
      canComment: true,
      joined: true,
      canJoin: false,
      joinByRequest: false,
      slowModeSeconds: 0,
    })
  })

  it('offers a join when the reader is not a member', () => {
    expect(composeCommentAccess({ joined: false, canComment: false })).toMatchObject({
      canComment: false,
      canJoin: true,
    })
  })

  it('never offers a join to a banned reader', () => {
    expect(composeCommentAccess({ joined: false, canComment: false, banned: true })).toMatchObject({
      canJoin: false,
    })
  })

  it('keeps the join-by-request flag', () => {
    expect(
      composeCommentAccess({ joined: false, canComment: false, joinByRequest: true }),
    ).toMatchObject({ joinByRequest: true })
  })

  it('only reports slow mode when posting is allowed', () => {
    expect(composeCommentAccess({ slowModeSeconds: 30 })).toMatchObject({ slowModeSeconds: 30 })
    expect(
      composeCommentAccess({ canComment: false, slowModeSeconds: 30 }),
    ).toMatchObject({ slowModeSeconds: 0 })
  })
})

describe('threadInteraction', () => {
  it('always opens the thread', () => {
    expect(threadInteraction(7)).toEqual({ comments: 7, canOpen: true })
  })

  it('carries the channel counters when present', () => {
    expect(threadInteraction(78, { views: 12_400, forwards: 96 })).toEqual({
      comments: 78,
      canOpen: true,
      views: 12_400,
      forwards: 96,
    })
  })
})
