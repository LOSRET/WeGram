import type { BrowserWindow } from 'electron'

import {
  attachNavigationPolicy,
  centerOnDisplay,
  createAppWindow,
  displayForWindow,
  repaintWindowChrome,
  showWhenReady,
} from './app-window'

/**
 * 设置 opens as its own window (design doc §9.11): a frameless 640 × 558 sheet,
 * centred on the display the shell lives on.
 *
 * It is deliberately **not** owned by the shell. An owned window is only "always
 * above its owner"; it never changes the task bar grouping (measured). What the
 * client's window does that an overlay cannot is sit beside the chat: the shell
 * can be raised over it, it can be dragged anywhere, and it keeps standing while
 * the reader works. The price is explicit: nothing closes it for us, so the
 * shell's own close, 退出登录 and `before-quit` all call `closeSettingsWindow()`
 * (see index.ts), or `window-all-closed` would never fire.
 *
 * The renderer half is `screens/SettingsWindow.tsx`, loaded through the
 * `#settings` hash of the same bundle.
 */
export const SETTINGS_WINDOW_W = 640
export const SETTINGS_WINDOW_H = 558

/** What the task bar calls it. */
const SETTINGS_TITLE = '设置'

let settingsWindow: BrowserWindow | null = null

export function openSettingsWindow(theme: 'light' | 'dark', anchor: BrowserWindow | null): void {
  const existing = getSettingsWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.moveTop()
    existing.focus()
    return
  }

  const win = createAppWindow({
    width: SETTINGS_WINDOW_W,
    height: SETTINGS_WINDOW_H,
    // The client's sheet is #fafafa in light; the dark theme keeps the pane colour.
    backgroundColor: theme === 'dark' ? '#1e1e1f' : '#fafafa',
    title: SETTINGS_TITLE,
    frameless: true,
    hash: 'settings',
  })
  settingsWindow = win
  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null
  })

  centerOnDisplay(
    win,
    { width: SETTINGS_WINDOW_W, height: SETTINGS_WINDOW_H },
    displayForWindow(anchor),
  )
  showWhenReady(win, { raise: true })

  // Settings is a dead end: it may not navigate anywhere or open a new window.
  attachNavigationPolicy(win, { links: 'deny', label: 'settings window' })
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
}

/** Called by the shell's own close, 退出登录 and quit — never by the × alone. */
export function closeSettingsWindow(): void {
  getSettingsWindow()?.close()
}

/**
 * The window has no title strip, so its backdrop is just a solid colour: repaint it
 * with the theme or a dark sheet flashes light for one frame after a switch.
 */
export function setSettingsTheme(theme: 'light' | 'dark'): void {
  repaintWindowChrome(getSettingsWindow(), {
    background: theme === 'dark' ? '#1e1e1f' : '#fafafa',
  })
}
