import { cacheLimitSchema, messageTextSizeSchema } from '@wegram/protocol'
import type { CacheLimit, MessageTextSize } from '@wegram/protocol'

import type { UiDatabase } from './ui-db'

/**
 * The shell-level preferences the settings window owns (design doc §9.11.3).
 *
 * They live in `ui.db` because they are only needed once a window exists, and they
 * are read on demand (at close time, at send time) rather than cached: a second
 * cache is how "I changed it but it still behaves the old way" happens.
 */

/** ui.db key holding the close behaviour; its value is a {@link CloseBehavior}. */
const CLOSE_BEHAVIOR_KEY = 'closeBehavior'
/** ui.db key holding the send rule; its value is a {@link SendKey}. */
const SEND_KEY = 'sendKey'
/** ui.db key holding 桌面通知; 'off' means the OS shows no toast at all. */
const DESKTOP_NOTIFICATIONS = 'notifications.desktop'
/** ui.db key holding 消息字号; its value is a {@link MessageTextSize}. */
const MESSAGE_TEXT_SIZE = 'messageTextSize'
/** ui.db key holding 缓存上限; its value is a {@link CacheLimit}. */
const CACHE_LIMIT = 'cacheLimit'

export type CloseBehavior = 'tray' | 'quit'
export type SendKey = 'enter' | 'ctrlEnter'

/**
 * 关闭主窗口: hide into the tray or quit. The default keeps the historical
 * behaviour (× quits), so an existing install does not start surviving its own
 * close button after an update.
 */
export function getCloseBehavior(uiDb: UiDatabase | null): CloseBehavior {
  return uiDb?.getSetting(CLOSE_BEHAVIOR_KEY) === 'tray' ? 'tray' : 'quit'
}

export function setCloseBehavior(uiDb: UiDatabase, value: CloseBehavior): void {
  uiDb.setSetting(CLOSE_BEHAVIOR_KEY, value)
}

/** 发送消息: Enter sends, or Ctrl+Enter does (Shift+Enter always breaks the line). */
export function getSendKey(uiDb: UiDatabase | null): SendKey {
  return uiDb?.getSetting(SEND_KEY) === 'ctrlEnter' ? 'ctrlEnter' : 'enter'
}

export function setSendKey(uiDb: UiDatabase, value: SendKey): void {
  uiDb.setSetting(SEND_KEY, value)
}

/**
 * 桌面通知: whether this installation pops OS toasts. Local rather than account
 * state (§9.11.3's 归属规则): the same account may want toasts on a desktop and none
 * on a laptop. Default on, like the client; an absent row is therefore "on".
 *
 * Read at notification time, not cached — turning it off must stop the next toast,
 * not the one after a restart.
 */
export function getDesktopNotifications(uiDb: UiDatabase | null): boolean {
  return uiDb?.getSetting(DESKTOP_NOTIFICATIONS) !== 'off'
}

export function setDesktopNotifications(uiDb: UiDatabase, enabled: boolean): void {
  uiDb.setSetting(DESKTOP_NOTIFICATIONS, enabled ? 'on' : 'off')
}

/**
 * 消息字号: four steps, and an absent row means 标准 — the size every existing
 * install already had, so an update never changes a transcript's metrics.
 *
 * The row is parsed rather than trusted: it is a string from a file another
 * build may have written, and an unknown step would otherwise reach the shell as
 * a `data-msg-size` value the stylesheet does not know.
 */
export function getMessageTextSize(uiDb: UiDatabase | null): MessageTextSize {
  const parsed = messageTextSizeSchema.safeParse(uiDb?.getSetting(MESSAGE_TEXT_SIZE))
  return parsed.success ? parsed.data : 'standard'
}

export function setMessageTextSize(uiDb: UiDatabase, value: MessageTextSize): void {
  uiDb.setSetting(MESSAGE_TEXT_SIZE, value)
}

/**
 * 缓存上限: how much disk the downloaded-media cache may take. Local rather than
 * account state (§9.11.3's 归属规则): the same account may allow a desktop 5 GB and
 * a laptop 512 MB. An absent or unreadable row is 不限制, which is what every
 * install had before the group existed — an update must not start deleting.
 */
export function getCacheLimit(uiDb: UiDatabase | null): CacheLimit {
  const parsed = cacheLimitSchema.safeParse(uiDb?.getSetting(CACHE_LIMIT))
  return parsed.success ? parsed.data : 'unlimited'
}

export function setCacheLimit(uiDb: UiDatabase, value: CacheLimit): void {
  uiDb.setSetting(CACHE_LIMIT, value)
}
