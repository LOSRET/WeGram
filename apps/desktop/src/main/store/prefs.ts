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
