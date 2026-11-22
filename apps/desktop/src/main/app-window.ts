import { join } from 'node:path'

import { app, BrowserWindow, shell } from 'electron'

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
