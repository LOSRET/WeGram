import { AppError } from '@wegram/protocol'
import type { MiniAppLaunch, MiniAppOpenRequest } from '@wegram/protocol'

import { miniAppTdlibTheme } from '../../../mini-app-theme'
import type { TdObject } from '../client'
import { displayName } from '../map/user'
import type { ActionDeps } from './deps'

/**
 * Mini Apps (Telegram Web Apps, design doc §9.4): the TDLib half.
 *
 * TDLib owns the signature. The page a bot serves is worthless without
 * `tgWebAppData`, which carries the account, the bot and the chat, signed with
 * the bot's token — so the URL must come from TDLib, never be built here, and
 * must not leave main. Four surfaces resolve it in three ways:
 *
 * - a reply keyboard key: `getWebAppUrl(bot_user_id, url)`
 * - an inline keyboard key or a bot menu button: `openWebApp(...)`, whose answer
 *   also carries the `launch_id` the client must release with `closeWebApp`
 * - a `t.me/<bot>/<app>` link: `getWebAppLinkUrl(...)`
 *
 * TDLib writes `application_name` into `tgWebAppPlatform`. It is a Telegram
 * platform identifier, not a free-form host name: Mini Apps use it to select
 * official-client behavior, so this desktop host uses `tdesktop`.
 */
const APPLICATION_NAME = 'tdesktop'

/** A signed Web App URL; anything that is not HTTPS is a bug, not a page. */
function signedUrl(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : ''
  try {
    if (new URL(url).protocol === 'https:') return url
  } catch {
    // Falls through to the one error below.
  }
  throw new AppError('tdlib_error', '机器人返回的小程序地址无效')
}

/** The bot's display name, which is what the official client titles the window. */
async function botTitle(deps: Pick<ActionDeps, 'invoke'>, botUserId: number): Promise<string> {
  const user = (await deps.invoke({ _: 'getUser', user_id: botUserId })) as TdObject
  if (user?.type?._ !== 'userTypeBot') {
    throw new AppError('invalid_payload', '这个按钮不属于机器人')
  }
  return displayName(user) || `机器人 ${botUserId}`
}

/**
 * The TDLib parameters every Web App open shares. `theme` is required by strict
 * launch-parameter parsers; without it TDLib omits `tgWebAppThemeParams` and the
 * page can reject the signed URL before its React tree mounts.
 */
function openParameters(theme: 'light' | 'dark'): TdObject {
  return {
    _: 'webAppOpenParameters',
    application_name: APPLICATION_NAME,
    theme: { _: 'themeParameters', ...miniAppTdlibTheme(theme) },
  }
}

export async function openMiniApp(
  deps: Pick<ActionDeps, 'invoke'>,
  input: MiniAppOpenRequest,
  theme: 'light' | 'dark',
): Promise<MiniAppLaunch> {
  if (input.source === 'link') {
    const { botUserId, chatId, title } = await resolveLinkBot(deps, input.username)
    const answer = (await deps.invoke({
      _: 'getWebAppLinkUrl',
      chat_id: input.chatId ?? chatId,
      bot_user_id: botUserId,
      web_app_short_name: input.shortName,
      start_parameter: input.startParameter ?? '',
      // False on purpose: write access means "this bot may message the account",
      // which the official client asks about once. This client has no consent
      // sheet yet, so it does not grant it behind the reader's back.
      allow_write_access: false,
      parameters: openParameters(theme),
    })) as TdObject
    return { title, botUserId, url: signedUrl(answer?.url) }
  }

  if (input.source === 'keyboard') {
    const title = await botTitle(deps, input.botUserId)
    const answer = (await deps.invoke({
      _: 'getWebAppUrl',
      bot_user_id: input.botUserId,
      url: input.url,
      parameters: openParameters(theme),
    })) as TdObject
    return { title, botUserId: input.botUserId, url: signedUrl(answer?.url) }
  }

  // A bot menu may name the Web App as a `t.me/<bot>/<app>` link instead of a
  // direct URL. TDLib's own docs say such a link must be processed as an
  // internalLinkTypeWebApp, i.e. through getWebAppLinkUrl, not openWebApp.
  const menuShortName = input.source === 'menu' ? telegramWebAppShortName(input.url) : undefined
  if (menuShortName) {
    const title = await botTitle(deps, input.botUserId)
    const answer = (await deps.invoke({
      _: 'getWebAppLinkUrl',
      chat_id: input.chatId ?? 0,
      bot_user_id: input.botUserId,
      web_app_short_name: menuShortName,
      start_parameter: startAppOf(input.url) ?? '',
      // Same rule as the link entry: no hidden write grant (no consent sheet yet).
      allow_write_access: false,
      parameters: openParameters(theme),
    })) as TdObject
    return { title, botUserId: input.botUserId, url: signedUrl(answer?.url) }
  }

  // An inline keyboard key and a direct-URL menu button both go through
  // openWebApp: it is the call that reserves a launch id for a Web App the bot
  // owns.
  const title = await botTitle(deps, input.botUserId)
  const answer = (await deps.invoke({
    _: 'openWebApp',
    chat_id: input.chatId ?? 0,
    bot_user_id: input.botUserId,
    url: input.url,
    parameters: openParameters(theme),
  })) as TdObject
  // TDLib's int64 may arrive as a string (its documented shape) or a number.
  const launchId =
    typeof answer?.launch_id === 'string'
      ? answer.launch_id
      : typeof answer?.launch_id === 'number'
        ? String(answer.launch_id)
        : ''
  return {
    title,
    botUserId: input.botUserId,
    url: signedUrl(answer?.url?.url ?? answer?.url),
    ...(launchId ? { launchId } : {}),
  }
}

/** `t.me/<bot>/<app>`: the app's short name, when the link names one. */
function telegramWebAppShortName(raw: string): string | undefined {
  try {
    const url = new URL(raw.trim())
    if (!['t.me', 'telegram.me', 'www.t.me', 'www.telegram.me'].includes(url.hostname)) {
      return undefined
    }
    const parts = url.pathname.split('/').filter((part) => part !== '')
    if (parts.length !== 2 || !/^[A-Za-z0-9_]{1,64}$/.test(parts[1] ?? '')) return undefined
    return parts[1]
  } catch {
    return undefined
  }
}

/** The `startapp` payload a menu button's t.me link carries. */
function startAppOf(raw: string): string | undefined {
  try {
    return new URL(raw.trim()).searchParams.get('startapp') ?? undefined
  } catch {
    return undefined
  }
}

/**
 * `t.me/<bot>/<app>`: the link names the bot's @username, so TDLib's own
 * resolver (`searchPublicChat`) is what turns it into the user id. A public
 * chat that is not a private bot is refused with the reader's words.
 */
async function resolveLinkBot(
  deps: Pick<ActionDeps, 'invoke'>,
  username: string,
): Promise<{ botUserId: number; chatId: number; title: string }> {
  const handle = username.replace(/^@/, '').trim()
  let chat: TdObject | undefined
  try {
    chat = (await deps.invoke({ _: 'searchPublicChat', username: handle })) as TdObject
  } catch {
    throw new AppError('invalid_payload', `找不到 @${handle}`)
  }
  const type = chat?.type
  const userId = Number(type?._ === 'chatTypePrivate' ? type.user_id : 0) || 0
  if (!userId) throw new AppError('invalid_payload', `@${handle} 不是机器人`)
  const user = (await deps.invoke({ _: 'getUser', user_id: userId })) as TdObject
  if (user?.type?._ !== 'userTypeBot') {
    throw new AppError('invalid_payload', `@${handle} 不是机器人`)
  }
  return {
    botUserId: userId,
    chatId: Number(chat?.id) || 0,
    title: displayName(user) || `机器人 ${userId}`,
  }
}

/**
 * TDLib opened the Web App through `openWebApp`: tell it the window went away.
 * A keyboard-button launch has no id, and closing one TDLib never reserved is
 * not an error worth surfacing.
 */
export async function closeMiniApp(
  deps: Pick<ActionDeps, 'invoke'>,
  launchId?: string,
): Promise<void> {
  if (!launchId || !/^\d+$/.test(launchId)) return
  await deps.invoke({ _: 'closeWebApp', web_app_launch_id: launchId })
}

/**
 * `WebApp.sendData(data)`: the only data path a Mini App controls besides its
 * own HTTPS calls. TDLib turns it into a `web_app_data` message from the bot;
 * `button_text` names the key that opened the app (empty for a menu app).
 */
export async function sendMiniAppData(
  deps: Pick<ActionDeps, 'invoke'>,
  input: { botUserId: number; buttonText: string; data: string },
): Promise<void> {
  await deps.invoke({
    _: 'sendWebAppData',
    bot_user_id: input.botUserId,
    button_text: input.buttonText,
    data: input.data,
  })
}

/** CloudStorage's four reserved methods use TDLib's generic custom-request seam. */
export async function invokeMiniAppCustomRequest(
  deps: Pick<ActionDeps, 'invoke'>,
  input: { botUserId: number; method: string; parameters: string },
): Promise<unknown> {
  const answer = (await deps.invoke({
    _: 'sendWebAppCustomRequest',
    bot_user_id: input.botUserId,
    method: input.method,
    parameters: input.parameters,
  })) as TdObject
  const raw = answer?.result
  if (typeof raw !== 'string') {
    throw new AppError('tdlib_error', '小程序存储请求没有返回结果')
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed
  } catch {
    throw new AppError('tdlib_error', '小程序存储请求返回了无效结果')
  }
}
