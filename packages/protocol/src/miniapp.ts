import { z } from 'zod'

/**
 * Mini Apps (Telegram Web Apps, design doc §9.4).
 *
 * A Mini App is a bot's HTTPS page opened in a web view. The *client* is the
 * gatekeeper: TDLib signs a URL for the bot and the chat (`tgWebAppData`), and
 * the page authenticates against that signature. The renderer therefore never
 * receives the signed URL, only the name the window's strip draws.
 *
 * Where a Mini App can be opened from is the bot's choice, and each surface
 * carries a different TDLib call:
 *
 * - a reply-keyboard key (`keyboardButtonTypeWebApp`) → `getWebAppUrl`
 * - an inline-keyboard key (`inlineKeyboardButtonTypeWebApp`) → `openWebApp`
 * - the bot's profile menu (`botMenuButton`) → `openWebApp`
 * - a `t.me/<bot>/<app>` link (`internalLinkTypeWebApp`) → `getWebAppLinkUrl`
 *
 * The renderer only says which surface was pressed; resolving the signed URL
 * belongs to the adapter, and the URL itself stays in main.
 */

/** What the reader pressed, as far as the adapter needs it. */
export const miniAppOpenRequestSchema = z.discriminatedUnion('source', [
  z.object({
    /**
     * A custom reply keyboard's Web App key. TDLib's `keyboardButtonTypeWebApp`
     * carries only the URL, so the bot and the button's label come with it.
     */
    source: z.literal('keyboard'),
    chatId: z.number().int(),
    botUserId: z.number().int().positive(),
    url: z.string().min(1),
    buttonText: z.string().min(1),
  }),
  z.object({
    /** An inline keyboard's Web App key; the bot is the message's sender. */
    source: z.literal('inline'),
    chatId: z.number().int(),
    botUserId: z.number().int().positive(),
    url: z.string().min(1),
    buttonText: z.string().min(1),
  }),
  z.object({
    /**
     * A bot's menu button (`botMenuButton`). Its URL travels from the profile
     * card, because that is where TDLib's `bot_info.menu_button` was mapped.
     */
    source: z.literal('menu'),
    botUserId: z.number().int().positive(),
    url: z.string().min(1),
    buttonText: z.string().min(1),
    /** The chat the card was opened from; absent when it came from 通讯录. */
    chatId: z.number().int().optional(),
  }),
  z.object({
    /** `t.me/<bot>/<app>?startapp=…`: only the bot's handle travelled in the link. */
    source: z.literal('link'),
    username: z.string().trim().min(3).max(64),
    shortName: z.string().trim().min(1).max(64),
    startParameter: z.string().max(512).optional(),
    /** The chat the link was clicked in; 0 (none) when it came from elsewhere. */
    chatId: z.number().int().optional(),
  }),
])
export type MiniAppOpenRequest = z.infer<typeof miniAppOpenRequestSchema>

const miniAppButtonColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i)

/** A MainButton / SecondaryButton after the guest's partial setup updates. */
export const miniAppButtonSchema = z.object({
  text: z.string(),
  /** Null means "use the current theme's default" rather than a page override. */
  color: miniAppButtonColorSchema.nullable(),
  textColor: miniAppButtonColorSchema.nullable(),
  isVisible: z.boolean(),
  isActive: z.boolean(),
  isProgressVisible: z.boolean(),
  hasShineEffect: z.boolean(),
  /** Only SecondaryButton reads this; MainButton keeps the default `left`. */
  position: z.enum(['left', 'right', 'top', 'bottom']),
})
export type MiniAppButton = z.infer<typeof miniAppButtonSchema>

/** Native chrome the guest asked for; `actionBarHeight` is owned by main. */
export const miniAppControlsSchema = z.object({
  main: miniAppButtonSchema,
  secondary: miniAppButtonSchema,
  backVisible: z.boolean(),
  settingsVisible: z.boolean(),
  bottomBarColor: miniAppButtonColorSchema.nullable(),
  actionBarHeight: z.number().int().min(0).max(112),
})
export type MiniAppControls = z.infer<typeof miniAppControlsSchema>

export const miniAppPressRequestSchema = z.object({
  target: z.enum(['main', 'secondary', 'back', 'settings']),
})
export type MiniAppPressRequest = z.infer<typeof miniAppPressRequestSchema>

/**
 * What `miniapp:init` answers: the strip's title, theme and native controls.
 * Never the signed URL — the window in main owns that.
 */
export const miniAppStateSchema = z.object({
  /** The bot's display name, which is what the official client titles the window. */
  title: z.string(),
  theme: z.enum(['light', 'dark']),
  controls: miniAppControlsSchema,
})
export type MiniAppState = z.infer<typeof miniAppStateSchema>

export const miniAppInvokeChannels = [
  /**
   * Opens (or re-targets) the Mini App window. The adapter resolves the signed
   * URL and main loads it in the guest web view; the renderer gets no payload.
   */
  'miniapp:open',
  /** Called by the Mini App window itself: its title + theme for the strip. */
  'miniapp:init',
  /**
   * The strip's ⋮: main pops the native menu (reload / terms / privacy /
   * report). A native menu is used because the guest web view paints above the
   * window's own DOM, so a renderer popover would be covered by the page.
   */
  'miniapp:menu',
  'miniapp:reload',
  'miniapp:close',
  /** The host renderer's native Back/Main/Secondary/Settings control was pressed. */
  'miniapp:press',
] as const

export const miniAppInvokeSchemas = {
  'miniapp:open': {
    request: miniAppOpenRequestSchema,
    response: z.void(),
  },
  'miniapp:init': {
    request: z.void(),
    response: miniAppStateSchema,
  },
  'miniapp:menu': {
    /** Anchor of the ⋮ in the window's client coordinates. */
    request: z.object({
      x: z.number().int().min(0).max(10000),
      y: z.number().int().min(0).max(10000),
    }),
    response: z.void(),
  },
  'miniapp:reload': {
    request: z.void(),
    response: z.void(),
  },
  'miniapp:close': {
    request: z.void(),
    response: z.void(),
  },
  'miniapp:press': {
    request: miniAppPressRequestSchema,
    response: z.void(),
  },
} satisfies Record<
  (typeof miniAppInvokeChannels)[number],
  { request: z.ZodType; response: z.ZodType }
>

/**
 * What an adapter hands back after resolving a Mini App: the signed URL (main
 * only) and the bot's name for the strip. `launchId` is TDLib's `openWebApp`
 * handle and must be passed to `closeWebApp` once the window goes away.
 */
export const miniAppLaunchSchema = z.object({
  title: z.string().min(1),
  /** The bot itself: `WebApp.sendData` and 举报 need its user id. */
  botUserId: z.number().int().positive(),
  url: z.string().min(1),
  launchId: z.string().optional(),
})
export type MiniAppLaunch = z.infer<typeof miniAppLaunchSchema>
