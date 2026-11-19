import type { AuthState } from '@wegram/protocol'

/** The signed-in account as the UI sees it: one row, one identity. */
export interface SelfIdentity {
  id: number
  name: string
  avatarUrl: string | undefined
}

/**
 * Id the placeholder avatar seeds its colour with before authorization.
 *
 * One value, not two: the transcript and the comment panel each had their own
 * (1000 and 0), so the same account drew two different placeholder colours
 * depending on which pane you looked at.
 */
export const SELF_PLACEHOLDER_ID = 1000

/** Name from the two parts TDLib splits, or the client's fallback before login. */
export function selfIdentity(auth: AuthState): SelfIdentity {
  if (auth.kind !== 'ready') {
    return { id: SELF_PLACEHOLDER_ID, name: '我', avatarUrl: undefined }
  }
  return {
    id: auth.me.id,
    name: [auth.me.firstName, auth.me.lastName].filter(Boolean).join(''),
    avatarUrl: auth.me.avatarUrl,
  }
}
