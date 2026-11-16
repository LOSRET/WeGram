import { join } from 'node:path'

import type { ProxyConfig } from '@wechatgram/protocol'

import type { TelegramAdapter } from './adapter'
import { MockAdapter } from './mock'
import { TdlibAdapter } from './tdlib'

export interface CreateAdapterOptions {
  apiId?: number
  apiHash?: string
  userDataDir: string
  initialProxy: ProxyConfig | null
}

/**
 * Chooses the protocol implementation.
 *
 * Without credentials the mock adapter runs, which is what lets the whole UI be
 * developed and demoed before Spike 2 (real login) is executed. Sessions live
 * under `userData/tdlib/<accountId>/`; v1 has exactly one account but the path
 * already has the shape multi-account will need (design doc §15).
 */
export function createAdapter(options: CreateAdapterOptions): TelegramAdapter {
  // WECHATGRAM_ADAPTER=mock forces the fake adapter even when credentials exist:
  // needed for UI work and demos that must not touch the real account.
  const forced = process.env['WECHATGRAM_ADAPTER']?.trim().toLowerCase()
  if (forced === 'mock') return new MockAdapter()

  if (options.apiId && options.apiHash) {
    // Dev escape hatch: point the app at an already-authorized session (for
    // example the one created by spikes/tdlib/login.mjs) instead of logging in
    // again inside the app.
    const override = process.env['WECHATGRAM_TDLIB_DIR']?.trim()
    const sessionDir = override || join(options.userDataDir, 'tdlib', 'default')
    return new TdlibAdapter({
      apiId: options.apiId,
      apiHash: options.apiHash,
      databaseDirectory: join(sessionDir, 'db'),
      filesDirectory: join(sessionDir, 'files'),
      initialProxy: options.initialProxy,
    })
  }
  return new MockAdapter()
}
