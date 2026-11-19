import type { CommentAccess } from './adapter'

/**
 * Whether the account may post in a discussion group (design doc §9.8).
 *
 * The official desktop client does not ask the server "can I comment"; it
 * derives the answer from the peer's membership flags and permissions
 * (`BottomControls::isJoinGroup` + `Data::CanSendAnyOf` in tdesktop). This module
 * is that rule, expressed over the fields TDLib exposes, so it is testable
 * without a client and identical for the mock and the real adapter.
 */

export type ChatMemberKind =
  | 'creator'
  | 'administrator'
  | 'member'
  | 'restricted'
  | 'left'
  | 'banned'
  /** The group could not be inspected; assume writable and let the send fail. */
  | 'unknown'

export interface CommentAccessInput {
  memberKind: ChatMemberKind
  /** `chatMemberStatusRestricted.is_member`: still a member despite limits. */
  restrictedIsMember: boolean
  /** `chat.permissions.can_send_basic_messages` — the default member permission. */
  defaultCanSend: boolean
  /** `chatMemberStatusRestricted.permissions.can_send_basic_messages`. */
  restrictedCanSend: boolean
  /** `supergroup.usernames` holds an active username (a public link exists). */
  hasPublicUsername: boolean
  /**
   * `supergroup.join_to_send_messages`. TDLib documents that this may be false
   * only for discussion supergroups and channel direct-message groups, which is
   * exactly why a public discussion group can be posted to without joining.
   */
  joinToSend: boolean
  /** `supergroup.join_by_request`: joins wait for an administrator. */
  joinByRequest: boolean
  /** `supergroup.is_broadcast_group`. */
  isBroadcast: boolean
  /** `supergroupFullInfo.slow_mode_delay_expires_in`, in seconds. */
  slowModeSeconds: number
}

export function resolveCommentAccess(input: CommentAccessInput): CommentAccess {
  if (input.memberKind === 'unknown') {
    return {
      canComment: true,
      joined: false,
      canJoin: false,
      joinByRequest: false,
      slowModeSeconds: 0,
    }
  }

  const member =
    input.memberKind === 'creator' ||
    input.memberKind === 'administrator' ||
    input.memberKind === 'member' ||
    (input.memberKind === 'restricted' && input.restrictedIsMember)
  const banned = input.memberKind === 'banned'

  // tdesktop: allowed = member, or a public link without join-to-send.
  const allowed = !banned && (member || (input.hasPublicUsername && !input.joinToSend))
  // Admins and the creator pass the rights check; everyone else needs the
  // permission that applies to them (their own when restricted, the default
  // otherwise).
  const rights =
    input.memberKind === 'creator' || input.memberKind === 'administrator'
      ? true
      : input.memberKind === 'restricted'
        ? input.restrictedCanSend
        : input.defaultCanSend
  const canComment = allowed && !input.isBroadcast && rights

  return {
    canComment,
    joined: member,
    canJoin: !member && !banned,
    joinByRequest: input.joinByRequest,
    slowModeSeconds: canComment ? Math.max(0, Math.floor(input.slowModeSeconds)) : 0,
  }
}
