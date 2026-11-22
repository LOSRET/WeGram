import { z } from 'zod'

import { connectionStateSchema } from './dto'
import { networkSettingsSchema } from './settings'

/**
 * TDLib's network preferences as their own channel table (design doc §6.4).
 *
 * They are not part of `proxy:*` because they apply with or without a proxy:
 * `prefer_ipv6` decides which address family the client tries first, for DC
 * connections and for proxy host resolution alike.
 */
export const networkInvokeChannels = ['network:get', 'network:set', 'network:connection'] as const

export const networkInvokeSchemas = {
  'network:get': { request: z.void(), response: networkSettingsSchema },
  'network:set': { request: networkSettingsSchema, response: z.void() },
  /**
   * TDLib's *current* connection state.
   *
   * `evt:connection` is published only when the state changes, and the shell window
   * is created after the login window — so a shell that mounts while TDLib is
   * already online used to draw 离线 until the next transition, which can be hours.
   * The shell seeds itself from this once, then follows the event.
   */
  'network:connection': { request: z.void(), response: connectionStateSchema },
}
