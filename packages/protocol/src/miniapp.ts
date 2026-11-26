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

/**
 * One row of the strip's ⋯ card. Main owns the list (and the side effect each
 * row runs); the card's own window only draws the labels it is handed.
 */
export const miniAppMenuItemSchema = z.object({
  id: z.enum(['reload', 'settings', 'terms', 'privacy', 'report']),
  label: z.string().min(1),
  /** A hairline above this row: 重载/设置 · 使用条款/隐私政策 · 举报. */
  dividerBefore: z.boolean(),
})
export type MiniAppMenuItem = z.infer<typeof miniAppMenuItemSchema>
export type MiniAppMenuAction = MiniAppMenuItem['id']

export const miniAppMenuAnchorSchema = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
})
export type MiniAppMenuAnchor = z.infer<typeof miniAppMenuAnchorSchema>

/** What the ⋯ card draws: its theme, the button it hangs from, its rows. */
export const miniAppMenuSchema = z.object({
  theme: z.enum(['light', 'dark']),
  /** The ⋯'s rectangle in the strip's client coordinates. */
  anchor: miniAppMenuAnchorSchema,
  items: z.array(miniAppMenuItemSchema),
})
export type MiniAppMenu = z.infer<typeof miniAppMenuSchema>

export const miniAppInvokeChannels = [
  /**
   * Opens (or re-targets) the Mini App window. The adapter resolves the signed
   * URL and main loads it in the guest web view; the renderer gets no payload.
   */
  'miniapp:open',
  /** Called by the Mini App window itself: its title + theme for the strip. */
  'miniapp:init',
  /**
   * The strip's ⋮: main opens the ⋯ card (reload / settings / terms / privacy /
   * report). It is the app's own WeChat-style card, drawn by a transparent
   * `WebContentsView` above the guest, because the page's view paints over the
   * window's DOM (design doc §9.4.1).
   */
  'miniapp:menu',
  /** The ⋯ card asks what to draw: its rows, theme and anchor. */
  'miniapp:menuState',
  /** The card was used: an action row's id, or null for "dismissed". */
  'miniapp:menuPick',
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
    /** The ⋯'s rectangle in the strip's client coordinates; the card hangs under it. */
    request: miniAppMenuAnchorSchema,
    response: z.void(),
  },
  'miniapp:menuState': {
    request: z.void(),
    response: miniAppMenuSchema,
  },
  'miniapp:menuPick': {
    request: z.object({ id: miniAppMenuItemSchema.shape.id.nullable() }),
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
