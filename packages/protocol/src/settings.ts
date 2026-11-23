import { z } from 'zod'

/**
 * Settings, proxy and app-metadata DTOs.
 *
 * Split out of `dto.ts` when the comment/interaction field brought that file to
 * its size budget (the same reason `contact.ts` exists). Nothing here
 * depends on the message model: these cross IPC on `settings:*`, `proxy:*` and
 * `app:info`.
 */

/**
 * Proxy configuration.
 *
 * Secrets crossing IPC are always `MASK` when already stored; sending `MASK`
 * back on `proxy:set` means "keep the stored secret" (design doc §6.4).
 *
 * `http` is a plain HTTP proxy used through CONNECT (TDLib's `proxyTypeHttp`
 * with `http_only: false`); TDLib cannot speak TLS to the proxy itself, so
 * `https://` proxy URLs are rejected by the parser.
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
    type: z.literal('http'),
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
 * Where the client's proxy comes from (design doc §6.4).
 *
 * `system` is the default and behaves the way the other messengers do: use the
 * operating system's proxy when there is one, connect directly when there is not.
 * `manual` uses the configuration in 设置 → 网络与代理, `off` always goes direct.
 */
export const proxyModeSchema = z.enum(['system', 'manual', 'off'])
export type ProxyMode = z.infer<typeof proxyModeSchema>

/**
 * Why the proxy in force is the one in force. `env` is the development-only
 * `WEGRAM_PROXY` override, which wins while the mode is `system`.
 */
export const proxySourceSchema = z.enum(['manual', 'env', 'system', 'direct'])
export type ProxySource = z.infer<typeof proxySourceSchema>

/**
 * What 网络与代理 paints: the chosen mode, the manual configuration (behind its own
 * masking), what the operating system reports, and what TDLib is really using.
 * `active` is the only field that describes the live connection.
 */
export const proxyStateSchema = z.object({
  mode: proxyModeSchema,
  config: proxyConfigSchema.nullable(),
  /** The operating system's answer, read while the mode is `system`. */
  system: proxyConfigSchema.nullable(),
  active: proxyConfigSchema.nullable(),
  source: proxySourceSchema,
  /** One sentence for the panel, e.g. 「系统代理无响应，本次直连」. */
  detail: z.string().optional(),
})
export type ProxyState = z.infer<typeof proxyStateSchema>

/**
 * TDLib network preferences the settings surface owns (design doc §6.4).
 *
 * `preferIpv6` is TDLib's writable `prefer_ipv6` option: with it on, the DC
 * connection list keeps only IPv6 addresses and the client resolves proxy hosts
 * with AAAA first. Off keeps TDLib's default (IPv4 first, IPv6 as a fallback).
 */
export const networkSettingsSchema = z.object({ preferIpv6: z.boolean() })
export type NetworkSettings = z.infer<typeof networkSettingsSchema>

/**
 * The picker's 最近使用 row holds this many, newest first. Main truncates on
 * save and the renderer draws what it gets; the protocol caps the request so a
 * stale renderer cannot grow the stored list.
 */
export const RECENT_EMOJI_LIMIT = 10

/**
 * 外观 has three states: an explicit light/dark, or "follow the system". The
 * resolved value is what every window paints with; the preference is what the
 * settings window stores (design doc §9.11.4).
 */
export const themePreferenceSchema = z.enum(['system', 'light', 'dark'])
export type ThemePreference = z.infer<typeof themePreferenceSchema>

/** What the shell's × does: hide into the tray, or quit. */
export const closeBehaviorSchema = z.enum(['tray', 'quit'])
export type CloseBehavior = z.infer<typeof closeBehaviorSchema>

/** 发送消息's Enter rule, WeChat's own pair. */
export const sendKeySchema = z.enum(['enter', 'ctrlEnter'])
export type SendKey = z.infer<typeof sendKeySchema>

export const appSettingsSchema = z.object({
  /** The theme every window should paint with — always resolved, never 'system'. */
  theme: z.enum(['light', 'dark']),
  /** The stored preference ('system' follows the OS and is resolved on read). */
  themePreference: themePreferenceSchema,
  closeBehavior: closeBehaviorSchema,
  sendKey: sendKeySchema,
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
