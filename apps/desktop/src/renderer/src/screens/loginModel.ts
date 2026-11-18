import type { AuthState, Self } from '@wegram/protocol'

/** Which form the login window shows for an authorization state. */
export type LoginStep = 'phone' | 'code' | 'password'

/**
 * The window's three sign-in steps. `idle`/`closed` never render a form (the
 * component shows its boot/closed panel instead), but they still answer 'phone'
 * so callers need no second branch.
 */
export function stepOf(auth: AuthState): LoginStep {
  switch (auth.kind) {
    case 'waitCode':
      return 'code'
    case 'waitPassword':
      return 'password'
    default:
      return 'phone'
  }
}

/**
 * What the profile step calls the account. TDLib guarantees a first name but it
 * can be empty; Telegram accounts may carry no username and no visible phone
 * either, so the last resort is the client's own `我`.
 */
export function displayName(me: Self): string {
  const full = [me.firstName, me.lastName].filter(Boolean).join('')
  if (full.trim()) return full
  if (me.username) return `@${me.username}`
  return me.phone ?? '我'
}
