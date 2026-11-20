import { join } from 'node:path'

import type { ProxyConfig } from '@wegram/protocol'

import type { TelegramAdapter } from './adapter'
import { MockAdapter } from './mock'
import { TdlibAdapter } from './tdlib'

/** `WEGRAM_TDLIB_TEST_DC` accepts 1/true/yes/on, like the other dev switches. */
const TEST_DC_ON = /^(1|true|yes|on)$/i

export interface CreateAdapterOptions {
  apiId?: number
  apiHash?: string
  userDataDir: string
  initialProxy: ProxyConfig | null
  /**
   * Development only. A packaged build refuses to start without credentials
   * (`main/index.ts`), so it also ignores `WEGRAM_ADAPTER=mock`: a release artifact
   * must never show the fixture data set.
   */
  allowMock: boolean
  /** Reported to Telegram as `application_version`; main passes app.getVersion(). */
  applicationVersion?: string
}

/**
 * Chooses the protocol implementation.
 *
 * Without credentials the mock adapter runs in development, which is what lets the
 * whole UI be developed and demoed without touching the real account. Sessions live
 * under `userData/tdlib/<accountId>/`; v1 has exactly one account but the path
 * already has the shape multi-account will need (design doc §15).
 */
export function createAdapter(options: CreateAdapterOptions): TelegramAdapter {
  const mock = (): TelegramAdapter =>
    new MockAdapter({ mediaDir: join(options.userDataDir, 'mock-media') })

  // WEGRAM_ADAPTER=mock forces the fake adapter even when credentials exist:
  // needed for UI work and demos that must not touch the real account.
  const forced = process.env['WEGRAM_ADAPTER']?.trim().toLowerCase()
  if (options.allowMock && forced === 'mock') return mock()

  if (options.apiId && options.apiHash) {
    // Dev escape hatch: point the app at an already-authorized session (for
    // example the one created by spikes/tdlib/login.mjs) instead of logging in
    // again inside the app.
    const override = process.env['WEGRAM_TDLIB_DIR']?.trim()
    // WEGRAM_TDLIB_TEST_DC=1 talks to the test data centers: a separate account
    // space where sending, editing and deleting cannot reach a real chat. The
    // session is its own directory — a test-DC client cannot open the
    // production database, and a real session must never be touched by accident.
    const testDc = TEST_DC_ON.test(process.env['WEGRAM_TDLIB_TEST_DC']?.trim() ?? '')
    const sessionDir = override || join(options.userDataDir, 'tdlib', testDc ? 'test' : 'default')
    return new TdlibAdapter({
      apiId: options.apiId,
      apiHash: options.apiHash,
      databaseDirectory: join(sessionDir, 'db'),
      filesDirectory: join(sessionDir, 'files'),
      useTestDc: testDc,
      initialProxy: options.initialProxy,
      ...(options.applicationVersion
        ? { applicationVersion: options.applicationVersion }
        : {}),
    })
  }

  if (!options.allowMock) {
    // bootstrap() already refused to start; reaching this point means a guard was
    // bypassed, and quietly shipping fixtures would hide that.
    throw new Error('no Telegram API credentials: a packaged build cannot run the mock adapter')
  }
  return mock()
}
