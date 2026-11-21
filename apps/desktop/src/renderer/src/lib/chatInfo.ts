import type { ChatMember, ChatSummary } from '@wegram/protocol'

/**
 * Rules behind the 聊天信息 side panel (design doc §9.9).
 *
 * The slide length is also read by the parent that keeps the panel mounted until
 * the way out has finished; the stylesheet cannot be read before paint, so the
 * number lives here and `styleContract.test.ts` pins the two together.
 */
export const INFO_PANEL_ANIM_MS = 200

/**
 * Participants one request asks for. The grid is four 66 px columns wide, so this
 * is three full rows before the client would start collapsing the list.
 */
export const INFO_MEMBER_LIMIT = 12

/** One face in the panel's participant grid. */
export interface PersonTile {
  /** Chat or user id — the seed of the initial-avatar colour. */
  id: number
  title: string
  avatarUrl?: string
}

/**
 * Which faces the grid draws.
 *
 * A group or channel shows its members. A private chat has no member table — the
 * client draws the conversation's own face there — and a channel whose member list
 * needs administrator rights answers with an empty list, which lands on the same
 * fallback so the grid is never blank.
 */
export function personTiles(members: ChatMember[], chat: ChatSummary): PersonTile[] {
  if (members.length > 0) {
    return members.map((member) => ({
      id: member.userId,
      title: member.title,
      ...(member.avatarUrl ? { avatarUrl: member.avatarUrl } : {}),
    }))
  }
  return [
    {
      id: chat.userId ?? chat.id,
      title: chat.title,
      ...(chat.avatarUrl ? { avatarUrl: chat.avatarUrl } : {}),
    },
  ]
}
