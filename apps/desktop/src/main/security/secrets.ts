import { safeStorage } from 'electron'

const DPAPI_PREFIX = 'dpapi:'
const PLAIN_PREFIX = 'plain:'

let warnedAboutPlaintext = false

/**
 * Encrypts a secret with the OS keychain (Windows DPAPI via Electron
 * safeStorage). Falls back to a marked plaintext value when no keychain is
 * available (dev on a bare container), so the app never silently loses data.
 */
export function sealSecret(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return DPAPI_PREFIX + safeStorage.encryptString(plain).toString('base64')
  }
  if (!warnedAboutPlaintext) {
    warnedAboutPlaintext = true
    console.warn('[secrets] safeStorage unavailable — falling back to marked plaintext')
  }
  return PLAIN_PREFIX + plain
}

export function unsealSecret(sealed: string | undefined): string | null {
  if (!sealed) return null
  if (sealed.startsWith(DPAPI_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(sealed.slice(DPAPI_PREFIX.length), 'base64'))
    } catch {
      return null
    }
  }
  if (sealed.startsWith(PLAIN_PREFIX)) return sealed.slice(PLAIN_PREFIX.length)
  return null
}
