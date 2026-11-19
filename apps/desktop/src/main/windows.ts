import type { BrowserWindow } from 'electron'

import { attachNavigationPolicy, createAppWindow } from './app-window'
import type { UiDatabase } from './store/ui-db'
import { createLogger } from './util'
import { hideViewerWithShell, showViewerWithShell } from './viewer'

const logger = createLogger('windows')

/**
 * Brings the shell window forward above the standalone viewer.
 *
 * Both are plain top-level windows, so `moveTop()` is what puts the chat on top of
 * the still-open picture (design: the viewer is not owned by the shell, which is
 * what keeps the task bar looking like WeChat's — one WeGram button with both
 * windows in its hover preview).
 */
export function raiseShellAboveViewer(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.moveTop()
  win.focus()
}

export function createMainWindow(theme: 'light' | 'dark'): BrowserWindow {
  const win = createAppWindow({
    width: 1000,
    height: 680,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: theme === 'dark' ? '#1e1e1f' : '#fbfbfb',
    overlay: shellTitleBarOverlay(theme),
  })

  win.once('ready-to-show', () => {
    applyTitleBarTheme(win, theme)
    win.show()
  })

  // The viewer is not owned by this window any more, so its "put the picture away
  // with the chat" behaviour is explicit here (see main/viewer.ts).
  win.on('minimize', hideViewerWithShell)
  win.on('restore', showViewerWithShell)

  attachNavigationPolicy(win, { links: 'open-external', label: 'shell' })

  return win
}

/** The shell's native window-controls strip; must match --wx-rail / --wx-rail-icon. */
function shellTitleBarOverlay(theme: 'light' | 'dark'): Electron.TitleBarOverlay {
  return {
    color: theme === 'dark' ? '#2d2d2e' : '#e0e0e0',
    symbolColor: theme === 'dark' ? '#969697' : '#191919',
    height: 32,
  }
}

export function storedTheme(uiDb: UiDatabase | null): 'light' | 'dark' {
  return uiDb?.getSetting('theme') === 'dark' ? 'dark' : 'light'
}

/**
 * titleBarOverlay is drawn by Windows, not by CSS, so it must be repainted when
 * the theme changes — otherwise a dark UI keeps a light window-controls strip.
 */
export function applyTitleBarTheme(win: BrowserWindow | null, theme: 'light' | 'dark'): void {
  if (!win || win.isDestroyed()) return
  try {
    win.setTitleBarOverlay(shellTitleBarOverlay(theme))
  } catch (error) {
    logger.warn(
      'setTitleBarOverlay failed:',
      error instanceof Error ? error.message : String(error),
    )
  }
}
