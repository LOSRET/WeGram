import { AppError } from '@wegram/protocol'
import type { AuthState } from '@wegram/protocol'

import type { TdObject } from './client'

/**
 * The authorization steps the login window drives, as functions over `AuthDeps`.
 *
 * TDLib is driven manually rather than through `tdl`'s `client.login()`, because
 * the UI needs explicit steps (phone → code → registration → password) and the
 * QR fallback needs a client rebuild. Keeping them here leaves the adapter file
 * owning only lifecycle, connection state and the `invoke` wrapper.
 */
export interface AuthDeps {
  invoke(method: TdObject): Promise<any>
  getAuth(): AuthState
  /** Destroys the current client and starts a fresh one on the same database. */
  resetClient(): Promise<void>
}

export async function submitPhone(deps: AuthDeps, phone: string): Promise<AuthState> {
  await deps.invoke({ _: 'setAuthenticationPhoneNumber', phone_number: phone, settings: null })
  return deps.getAuth()
}

export async function submitCode(deps: AuthDeps, code: string): Promise<AuthState> {
  await deps.invoke({ _: 'checkAuthenticationCode', code })
  return deps.getAuth()
}

export async function submitPassword(deps: AuthDeps, password: string): Promise<AuthState> {
  await deps.invoke({ _: 'checkAuthenticationPassword', password })
  return deps.getAuth()
}

/**
 * `authorizationStateWaitRegistration`: the number has no account behind it yet,
 * so TDLib asks for a name before the account exists.
 */
export async function signUp(
  deps: AuthDeps,
  input: { firstName: string; lastName?: string },
): Promise<AuthState> {
  await deps.invoke({
    _: 'registerUser',
    first_name: input.firstName,
    last_name: input.lastName ?? '',
  })
  return deps.getAuth()
}

/**
 * TDLib's QR login: valid in `waitPhoneNumber`; the answer arrives as an
 * `updateAuthorizationState` with `authorizationStateWaitOtherDeviceConfirmation`
 * and a fresh `tg://login?token=…` link, which the mapper turns into `waitQr`.
 */
export async function requestQrCode(deps: AuthDeps): Promise<AuthState> {
  await deps.invoke({ _: 'requestQrCodeAuthentication' })
  return deps.getAuth()
}

/**
 * Switch from QR to the phone form. TDLib has no call to cancel a pending
 * `waitOtherDeviceConfirmation` (setAuthenticationPhoneNumber refuses that
 * state), so the only way is to destroy the instance and start a fresh one.
 * Nothing is stored yet at this point, so destroying the database is safe.
 */
export async function restartAuth(deps: AuthDeps): Promise<AuthState> {
  if (deps.getAuth().kind === 'ready') {
    throw new AppError('invalid_payload', 'Already signed in')
  }
  await deps.resetClient()
  return deps.getAuth()
}
