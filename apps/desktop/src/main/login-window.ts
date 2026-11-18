import { join } from 'node:path'

import { app, BrowserWindow, screen } from 'electron'

import { createLogger } from './util'

const logger = createLogger('login')

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
  const win = new BrowserWindow({
    width: LOGIN_WINDOW_W,
    height: LOGIN_WINDOW_H,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: LOGIN_TITLE,
    // The client's sheet is #fafafa, a touch warmer than the shell's #fbfbfb.
    backgroundColor: theme === 'dark' ? '#1e1e1f' : '#fafafa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn(`login window refused window.open(${url})`)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl && url.startsWith(rendererUrl)) return
    event.preventDefault()
    logger.warn(`login window refused navigation to ${url}`)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(`${devUrl}#login`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'login' })
  }

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
