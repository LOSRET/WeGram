import type { BrowserWindow } from 'electron'
import { screen } from 'electron'

import { attachNavigationPolicy, createAppWindow } from './app-window'

/**
 * The login window is its own window, like WeChat's: 280×373 DIP measured off the
 * client at 125% scaling (350×466 device px), frameless with a self-drawn strip
 * because it carries no minimise/maximise controls at all.
 *
 * Design: docs/技术方案.md §9.6. The renderer half is `screens/LoginWindow.tsx`,
 * loaded through the `#login` hash of the same bundle the shell uses.
 */
export const LOGIN_WINDOW_W = 280
export const LOGIN_WINDOW_H = 373

/** What the task bar calls it. */
const LOGIN_TITLE = 'WeGram'

let loginWindow: BrowserWindow | null = null

export function createLoginWindow(theme: 'light' | 'dark'): BrowserWindow {
  const win = createAppWindow({
    width: LOGIN_WINDOW_W,
    height: LOGIN_WINDOW_H,
    // The client's sheet is #fafafa, a touch warmer than the shell's #fbfbfb.
    backgroundColor: theme === 'dark' ? '#1e1e1f' : '#fafafa',
    title: LOGIN_TITLE,
    frameless: true,
    hash: 'login',
  })

  loginWindow = win
  win.on('closed', () => {
    if (loginWindow === win) loginWindow = null
  })

  // Centred in the work area, like the client's login window.
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  win.setBounds({
    x: Math.round(x + (width - LOGIN_WINDOW_W) / 2),
    y: Math.round(y + (height - LOGIN_WINDOW_H) / 2),
    width: LOGIN_WINDOW_W,
    height: LOGIN_WINDOW_H,
  })

  win.once('ready-to-show', () => win.show())

  // The only window while the reader is signed out: it may not navigate at all.
  attachNavigationPolicy(win, { links: 'deny', label: 'login window' })

  return win
}

export function getLoginWindow(): BrowserWindow | null {
  return loginWindow && !loginWindow.isDestroyed() ? loginWindow : null
}

/**
 * The × in the self-drawn title strip. It is the only window while the reader is
 * signed out, so closing it quits the app through `window-all-closed`.
 */
export function closeLoginWindow(): void {
  getLoginWindow()?.close()
}
