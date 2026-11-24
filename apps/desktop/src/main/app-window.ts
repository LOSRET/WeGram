import { join } from 'node:path'

import { app, BrowserWindow, screen, shell } from 'electron'

import { createLogger } from './util'

const logger = createLogger('window')

/**
 * The one place a renderer window is built.
 *
 * Every renderer window (shell, login, viewer, 群二维码, 设置) is the same sandboxed page
 * family:
 * a preload script, context isolation, no node integration, sandbox on, no
 * spellcheck. That is a security contract, not styling — a copy per window is
 * how one of them eventually ships without `sandbox` or without the external
 * link check. Only the geometry, the theme colours and the route differ.
 */
export interface AppWindowSpec {
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  backgroundColor: string
  title?: string
  /** No native frame (the login window paints its own strip) and no resizing. */
  frameless?: boolean
  /** The window's own window-controls overlay, when it has a title strip. */
  overlay?: Electron.TitleBarOverlay
  /** Renderer route to boot on: `login`, `viewer`; omitted for the shell. */
  hash?: string
}

export function createAppWindow(spec: AppWindowSpec): BrowserWindow {
  const win = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    ...(spec.minWidth === undefined ? {} : { minWidth: spec.minWidth }),
    ...(spec.minHeight === undefined ? {} : { minHeight: spec.minHeight }),
    show: false,
    ...(spec.frameless
      ? {
          frame: false,
          resizable: false,
          maximizable: false,
          minimizable: false,
          fullscreenable: false,
        }
      : {}),
    // A window with an overlay paints its own title strip into the frame; a
    // frameless one (login) has no strip to describe.
    ...(spec.overlay ? { titleBarStyle: 'hidden', titleBarOverlay: spec.overlay } : {}),
    backgroundColor: spec.backgroundColor,
    ...(spec.title === undefined ? {} : { title: spec.title }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  loadRenderer(win, spec.hash)
  return win
}

/** Loads the shared bundle on one of its routes (dev server or packaged file). */
export function loadRenderer(win: BrowserWindow, hash?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
    return
  }
  const file = join(__dirname, '../renderer/index.html')
  void (hash ? win.loadFile(file, { hash }) : win.loadFile(file))
}

/** The display an anchored window opens on: the anchor's, else the primary one. */
export function displayForWindow(anchor: BrowserWindow | null): Electron.Display {
  if (anchor && !anchor.isDestroyed()) return screen.getDisplayMatching(anchor.getBounds())
  return screen.getPrimaryDisplay()
}

/**
 * The display under the pointer: where 图片和视频 and 即时预览 open, because the
 * reader clicked something on that screen.
 */
export function displayForCursor(anchor: BrowserWindow | null): Electron.Display {
  if (anchor && !anchor.isDestroyed()) return screen.getDisplayMatching(anchor.getBounds())
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

/** Centres a window in a display's work area. */
export function centerOnDisplay(
  win: BrowserWindow,
  size: { width: number; height: number },
  display: Electron.Display,
): void {
  const { x, y, width, height } = display.workArea
  win.setBounds({
    x: Math.round(x + (width - size.width) / 2),
    y: Math.round(y + (height - size.height) / 2),
    width: size.width,
    height: size.height,
  })
}

/**
 * Shows a window once its renderer has painted.
 *
 * `raise` is for a window nothing owns (the viewer, 即时预览, the sheets): Windows
 * does not put it above the shell by itself, and focusing alone would leave it
 * behind. `focus` is the middle case (群二维码, which is owned); the login window
 * only appears.
 */
export function showWhenReady(
  win: BrowserWindow,
  options: { raise?: boolean; focus?: boolean } = {},
): void {
  win.once('ready-to-show', () => {
    win.show()
    if (options.raise) {
      win.moveTop()
      win.focus()
    } else if (options.focus) {
      win.focus()
    }
  })
}

/**
 * Repaints the parts of a window the renderer cannot: the native background (a dark
 * theme otherwise flashes a light sheet for one frame) and the title strip Windows
 * draws. A window that is mid-teardown refuses the call; nothing to repaint then.
 */
export function repaintWindowChrome(
  win: BrowserWindow | null,
  options: { background?: string; overlay?: Electron.TitleBarOverlay },
): void {
  if (!win || win.isDestroyed()) return
  try {
    if (options.overlay) win.setTitleBarOverlay(options.overlay)
    if (options.background) win.setBackgroundColor(options.background)
  } catch (error) {
    logger.warn(
      'repaintWindowChrome failed:',
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * What the window does with a link or a navigation it did not ask for.
 *
 * `open-external` is the shell's policy (https and tg: leave the app, design doc
 * §8.3); `deny` is for windows that may not leave their route at all.
 */
export type LinkPolicy = 'open-external' | 'deny'

export function attachNavigationPolicy(
  win: BrowserWindow,
  options: { links: LinkPolicy; label: string },
): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (options.links === 'open-external') openExternal(url)
    else logger.warn(`${options.label} refused window.open(${url})`)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl && url.startsWith(rendererUrl)) return
    event.preventDefault()
    if (options.links === 'open-external') openExternal(url)
    else logger.warn(`${options.label} refused navigation to ${url}`)
  })
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
