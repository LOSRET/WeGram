import { z } from 'zod'

/**
 * Presence: what a person is doing right now, and what the shell tells main it is
 * showing.
 *
 * `user.status` is on TDLib's basic user object, so the answer is cheap, but it
 * changes on its own schedule — hence the `evt:status` stream rather than a value
 * copied into every chat summary.
 */
export const peerStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('online') }),
  /**
   * An exact last-seen time. TDLib omits it (`userStatusRecently`) when the
   * account's privacy settings hide the hour, so this variant means Telegram
   * actually told us when.
   */
  z.object({ kind: z.literal('offline'), wasOnline: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('recently') }),
  z.object({ kind: z.literal('lastWeek') }),
  z.object({ kind: z.literal('lastMonth') }),
])
export type PeerStatus = z.infer<typeof peerStatusSchema>

export const presenceInvokeChannels = [
  /** Online / last seen for one user (the open private chat's header). */
  'users:status',
  /**
   * Which conversation the shell is showing, or null when it shows none. Main
   * suppresses a desktop notification for that chat while the shell is focused —
   * the renderer owns the active chat, so it has to report it.
   */
  'ui:setActiveChat',
] as const

export const presenceInvokeSchemas = {
  'users:status': {
    request: z.object({ userId: z.number().int() }),
    response: peerStatusSchema.nullable(),
  },
  'ui:setActiveChat': {
    request: z.object({ chatId: z.number().int().nullable() }),
    response: z.void(),
  },
}
