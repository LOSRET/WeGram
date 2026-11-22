import { z } from 'zod'

import { networkSettingsSchema } from './settings'

/**
 * TDLib's network preferences as their own channel table (design doc §6.4).
 *
 * They are not part of `proxy:*` because they apply with or without a proxy:
 * `prefer_ipv6` decides which address family the client tries first, for DC
 * connections and for proxy host resolution alike.
 */
export const networkInvokeChannels = ['network:get', 'network:set'] as const

export const networkInvokeSchemas = {
  'network:get': { request: z.void(), response: networkSettingsSchema },
  'network:set': { request: networkSettingsSchema, response: z.void() },
}
