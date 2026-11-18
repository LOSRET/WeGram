import { join } from 'node:path'

import type { ProxyConfig } from '@wegram/protocol'

import type { TelegramAdapter } from './adapter'
import { MockAdapter } from './mock'
import { TdlibAdapter } from './tdlib'

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
    const sessionDir = override || join(options.userDataDir, 'tdlib', 'default')
    return new TdlibAdapter({
      apiId: options.apiId,
      apiHash: options.apiHash,
      databaseDirectory: join(sessionDir, 'db'),
      filesDirectory: join(sessionDir, 'files'),
      initialProxy: options.initialProxy,
    })
  }

  if (!options.allowMock) {
    // bootstrap() already refused to start; reaching this point means a guard was
    // bypassed, and quietly shipping fixtures would hide that.
    throw new Error('no Telegram API credentials: a packaged build cannot run the mock adapter')
  }
  return mock()
}
