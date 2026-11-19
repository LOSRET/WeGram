import { z } from 'zod'

/**
 * Settings, proxy and app-metadata DTOs.
 *
 * Split out of `dto.ts` when the comment/interaction field brought that file to
 * its 550-line budget (the same reason `contact.ts` exists). Nothing here
 * depends on the message model: these cross IPC on `settings:*`, `proxy:*` and
 * `app:info`.
 */

/**
 * Proxy configuration.
 *
 * Secrets crossing IPC are always `MASK` when already stored; sending `MASK`
 * back on `proxy:set` means "keep the stored secret" (design doc §6.4).
 */
export const MASK = '***' as const

export const proxyConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('socks5'),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    username: z.string().optional(),
    password: z.string().optional(),
  }),
  z.object({
    type: z.literal('mtproto'),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secret: z.string().optional(),
  }),
])
export type ProxyConfig = z.infer<typeof proxyConfigSchema>

export const proxyTestResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
})
export type ProxyTestResult = z.infer<typeof proxyTestResultSchema>

/**
 * The picker's 最近使用 row holds this many, newest first. Main truncates on
 * save and the renderer draws what it gets; the protocol caps the request so a
 * stale renderer cannot grow the stored list.
 */
export const RECENT_EMOJI_LIMIT = 10

export const appSettingsSchema = z.object({
  theme: z.enum(['light', 'dark']),
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const appInfoSchema = z.object({
  version: z.string(),
  appVersion: z.string(),
  adapter: z.enum(['mock', 'tdlib']),
  tdlibVersion: z.string().optional(),
  userDataPath: z.string(),
})
export type AppInfo = z.infer<typeof appInfoSchema>
