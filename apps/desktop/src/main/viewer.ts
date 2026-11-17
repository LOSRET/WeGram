import { join } from 'node:path'

import type { ViewerItem, ViewerState } from '@wegram/protocol'
import { AppError } from '@wegram/protocol'
import { app, BrowserWindow, screen } from 'electron'

import { createLogger } from './util'
import { VIEWER_MIN_H, VIEWER_MIN_W, viewerWindowSize } from './viewer-size'

const logger = createLogger('viewer')

/** Height of the toolbar in the viewer window; also the titleBarOverlay height. */
export const VIEWER_TOOLBAR_H = 40

/** What the client calls its viewer window in the task bar. */
const VIEWER_TITLE = '图片和视频'

export interface ViewerRequest {
  items: ViewerItem[]
  index: number
}

let viewerWindow: BrowserWindow | null = null
let request: ViewerRequest | null = null
let theme: 'light' | 'dark' = 'light'

/**
 * WeChat opens media in its own window (图片和视频): a toolbar strip carrying the
 * window controls, the photo or video underneath on a light canvas. That window
 * is independent of the transcript but stays above it, so it is parented to the
 * main window and centred on the same display.
 */
export function openViewer(next: ViewerRequest, parent: BrowserWindow | null): void {
  request = { ...next, index: clampIndex(next.index, next.items.length) }

  const existing = viewerWindow
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    // The viewer keeps no state worth merging, so a reload is the whole
    // "re-target" protocol: reload re-reads `viewer:init`. A dedicated event
    // channel would need a seq counter and exists only for adapter events.
    existing.webContents.reload()
    return
  }

  const win = createViewerWindow(parent)
  viewerWindow = win
  win.on('closed', () => {
    viewerWindow = null
    request = null
  })
}

export function getViewerWindow(): BrowserWindow | null {
  return viewerWindow && !viewerWindow.isDestroyed() ? viewerWindow : null
}

/** What `viewer:init` answers. Only the viewer window calls it. */
export function viewerState(): ViewerState {
  if (!request) throw new AppError('internal', 'Nothing is open in the viewer')
  return { items: request.items, index: request.index, theme }
}

/** The item the viewer was opened with, for 保存/复制/在文件夹中显示 naming. */
export function viewerItem(fileId: number): ViewerItem | null {
  return request?.items.find((item) => item.fileId === fileId) ?? null
}

export function setViewerPin(onTop: boolean): boolean {
  const win = getViewerWindow()
  if (!win) return false
  win.setAlwaysOnTop(onTop)
  return win.isAlwaysOnTop()
}

export function closeViewer(): void {
  viewerWindow?.close()
}

export function isViewerWindow(win: BrowserWindow | null): boolean {
  return Boolean(win && win === viewerWindow)
}

/** Repaints the native window-controls strip when the app theme changes. */
export function setViewerTheme(next: 'light' | 'dark'): void {
  theme = next
  const win = getViewerWindow()
  if (!win) return
  try {
    win.setTitleBarOverlay(titleBarOverlay(next))
  } catch (error) {
    logger.warn(
      'setTitleBarOverlay failed:',
      error instanceof Error ? error.message : String(error),
    )
  }
}

function createViewerWindow(parent: BrowserWindow | null): BrowserWindow {
  const display = parent
    ? screen.getDisplayMatching(parent.getBounds())
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const size = viewerWindowSize({
    screen: display.size,
    workArea: display.workAreaSize,
  })

  const win = new BrowserWindow({
    ...size,
    minWidth: VIEWER_MIN_W,
    minHeight: VIEWER_MIN_H,
    show: false,
    // The viewer paints its own toolbar into the title strip, like the shell.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(theme),
    ...(parent ? { parent } : {}),
    backgroundColor: theme === 'dark' ? '#141414' : '#f7f7f7',
    title: VIEWER_TITLE,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  // Centred inside the work area, like the client's viewer.
  const { x, y, width, height } = display.workArea
  win.setBounds({
    x: Math.round(x + (width - size.width) / 2),
    y: Math.round(y + (height - size.height) / 2),
    width: size.width,
    height: size.height,
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn(`viewer refused window.open(${url})`)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(`${devUrl}#viewer`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'viewer' })
  }

  return win
}

function titleBarOverlay(next: 'light' | 'dark'): {
  color: string
  symbolColor: string
  height: number
} {
  return {
    // Must match --wx-viewer-bar, or the strip reads as a seam.
    color: next === 'dark' ? '#1f1f1f' : '#e6e6e6',
    symbolColor: next === 'dark' ? '#d6d6d6' : '#191919',
    height: VIEWER_TOOLBAR_H,
  }
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(0, index), length - 1)
}
