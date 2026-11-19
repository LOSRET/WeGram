import { join } from 'node:path'

import { app, BrowserWindow, shell } from 'electron'

import type { UiDatabase } from './store/ui-db'
import { createLogger } from './util'
import { hideViewerWithShell, showViewerWithShell } from './viewer'

const logger = createLogger('windows')
const isDev = !app.isPackaged

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
  const win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: theme === 'dark' ? '#1e1e1f' : '#fbfbfb',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // Must match --wx-rail / --wx-rail-icon, or the strip reads as a seam.
      color: theme === 'dark' ? '#2d2d2e' : '#e0e0e0',
      symbolColor: theme === 'dark' ? '#969697' : '#191919',
      height: 32,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => {
    applyTitleBarTheme(win, theme)
    win.show()
  })

  // The viewer is not owned by this window any more, so its "put the picture away
  // with the chat" behaviour is explicit here (see main/viewer.ts).
  win.on('minimize', hideViewerWithShell)
  win.on('restore', showViewerWithShell)

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl && url.startsWith(rendererUrl)) return
    event.preventDefault()
    openExternal(url)
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** Only https and tg: links leave the app (design doc §8.3). */
function openExternal(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'tg:') {
      void shell.openExternal(url)
    }
  } catch {
    logger.warn('refused to open malformed URL')
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
    win.setTitleBarOverlay({
      color: theme === 'dark' ? '#2d2d2e' : '#e0e0e0',
      symbolColor: theme === 'dark' ? '#969697' : '#191919',
      height: 32,
    })
  } catch (error) {
    logger.warn(
      'setTitleBarOverlay failed:',
      error instanceof Error ? error.message : String(error),
    )
  }
}

