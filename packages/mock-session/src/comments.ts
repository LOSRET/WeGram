/**
 * The fake side of the comment contract (design doc §9.8).
 *
 * A fake account has no TDLib membership model to inspect, so both fakes keep
 * five flags on the fixture and derive the access answer from them. That
 * derivation is one rule; this is its only copy. The output shape is declared
 * here rather than imported because `CommentAccess` still lives in the main
 * adapter — the structural match is what call sites rely on (moving that type
 * into packages/protocol is a separate change).
 */

export interface FakeCommentFlags {
  joined?: boolean
  canComment?: boolean
  joinByRequest?: boolean
  slowModeSeconds?: number
  banned?: boolean
}

export interface ComposedCommentAccess {
  canComment: boolean
  joined: boolean
  canJoin: boolean
  joinByRequest: boolean
  slowModeSeconds: number
}

export function composeCommentAccess(flags: FakeCommentFlags = {}): ComposedCommentAccess {
  const joined = flags.joined ?? true
  const canComment = flags.canComment ?? joined
  const banned = flags.banned ?? false
  return {
    canComment,
    joined,
    canJoin: !joined && !banned && !canComment,
    joinByRequest: flags.joinByRequest ?? false,
    // Slow mode only counts while the reader is allowed to post at all.
    slowModeSeconds: canComment ? (flags.slowModeSeconds ?? 0) : 0,
  }
}

export interface CommentInteraction {
  comments: number
  canOpen: boolean
  views?: number
  forwards?: number
}

/** The comment bar's numbers for a thread, plus optional channel counters. */
export function threadInteraction(
  count: number,
  extra: { views?: number; forwards?: number } = {},
): CommentInteraction {
  return {
    comments: count,
    canOpen: true,
    ...(extra.views ? { views: extra.views } : {}),
    ...(extra.forwards ? { forwards: extra.forwards } : {}),
  }
}
