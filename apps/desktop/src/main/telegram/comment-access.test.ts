import { describe, expect, it } from 'vitest'

import { resolveCommentAccess, type CommentAccessInput } from './comment-access'

const input = (overrides: Partial<CommentAccessInput> = {}): CommentAccessInput => ({
  memberKind: 'member',
  restrictedIsMember: false,
  defaultCanSend: true,
  restrictedCanSend: true,
  hasPublicUsername: true,
  joinToSend: false,
  joinByRequest: false,
  isBroadcast: false,
  slowModeSeconds: 0,
  ...overrides,
})

describe('resolveCommentAccess', () => {
  it('lets a member with the default permission write', () => {
    expect(resolveCommentAccess(input())).toEqual({
      canComment: true,
      joined: true,
      canJoin: false,
      joinByRequest: false,
      slowModeSeconds: 0,
    })
  })

  it('refuses a member the group muted without offering a join button', () => {
    const access = resolveCommentAccess(input({ defaultCanSend: false }))
    expect(access.canComment).toBe(false)
    expect(access.joined).toBe(true)
    expect(access.canJoin).toBe(false)
  })

  it('uses the restricted member permissions, not the default ones', () => {
    const muted = resolveCommentAccess(
      input({
        memberKind: 'restricted',
        restrictedIsMember: true,
        restrictedCanSend: false,
        defaultCanSend: true,
      }),
    )
    expect(muted.canComment).toBe(false)
    expect(muted.joined).toBe(true)

    const allowed = resolveCommentAccess(
      input({
        memberKind: 'restricted',
        restrictedIsMember: true,
        restrictedCanSend: true,
        defaultCanSend: false,
      }),
    )
    expect(allowed.canComment).toBe(true)
  })

  it('lets a non-member post in a public discussion group that does not require joining', () => {
    const access = resolveCommentAccess(input({ memberKind: 'left' }))
    expect(access).toMatchObject({ canComment: true, joined: false, canJoin: true })
  })

  it('offers the join button when joining is required', () => {
    const access = resolveCommentAccess(input({ memberKind: 'left', joinToSend: true }))
    expect(access).toMatchObject({ canComment: false, joined: false, canJoin: true })
  })

  it('offers the join button for a private discussion group', () => {
    const access = resolveCommentAccess(input({ memberKind: 'left', hasPublicUsername: false }))
    expect(access.canComment).toBe(false)
    expect(access.canJoin).toBe(true)
  })

  it('marks a join-request group so the button says 申请', () => {
    const access = resolveCommentAccess(
      input({ memberKind: 'left', joinToSend: true, joinByRequest: true }),
    )
    expect(access.joinByRequest).toBe(true)
  })

  it('never offers to join for a banned account', () => {
    const access = resolveCommentAccess(input({ memberKind: 'banned' }))
    expect(access).toMatchObject({ canComment: false, canJoin: false, joined: false })
  })

  it('treats a restricted non-member as a non-member', () => {
    const access = resolveCommentAccess(
      input({ memberKind: 'restricted', restrictedIsMember: false, joinToSend: true }),
    )
    expect(access).toMatchObject({ canComment: false, joined: false, canJoin: true })
  })

  it('assumes writable when the group could not be inspected', () => {
    expect(resolveCommentAccess(input({ memberKind: 'unknown' }))).toEqual({
      canComment: true,
      joined: false,
      canJoin: false,
      joinByRequest: false,
      slowModeSeconds: 0,
    })
  })

  it('carries the slow-mode countdown only when the composer is usable', () => {
    expect(resolveCommentAccess(input({ slowModeSeconds: 42 })).slowModeSeconds).toBe(42)
    expect(
      resolveCommentAccess(input({ memberKind: 'left', joinToSend: true, slowModeSeconds: 42 }))
        .slowModeSeconds,
    ).toBe(0)
  })
})
