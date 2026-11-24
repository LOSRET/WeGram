import type { ViewerItem, ViewerState } from '@wegram/protocol'
import { AppError } from '@wegram/protocol'
import { BrowserWindow } from 'electron'

import {
  attachNavigationPolicy,
  centerOnDisplay,
  createAppWindow,
  displayForCursor,
  repaintWindowChrome,
  showWhenReady,
} from './app-window'
import { VIEWER_MIN_H, VIEWER_MIN_W, viewerWindowSize } from './viewer-size'

/** Height of the toolbar in the viewer window; also the titleBarOverlay height. */
export const VIEWER_TOOLBAR_H = 40

/** What the client calls its viewer window in the task bar. */
const VIEWER_TITLE = '图片和视频'

export interface ViewerRequest {
  /**
   * The conversation the strip came from; 定位到聊天位置 hands it back to the shell.
   * Absent when the strip belongs to no chat (即时预览's page media, §8.9).
   */
  chatId?: number
  items: ViewerItem[]
  index: number
}

let viewerWindow: BrowserWindow | null = null
let request: ViewerRequest | null = null
let theme: 'light' | 'dark' = 'light'

/**
 * WeChat opens media in its own window (图片和视频): a toolbar strip carrying the
 * window controls, the photo or video underneath on a light canvas.
 *
 * It is a **plain top-level window**, not a child of the shell. That is what makes
 * the task bar behave like WeChat's: one WeGram button whose hover preview lists
 * both windows (the client shows 微信 and 图片和视频 the same way — Windows groups
 * by application, not by window ownership). The price is that nothing keeps the two
 * windows in order for us, so what ownership gave for free is explicit: the shell
 * raises itself with `moveTop()` (index.ts `raiseShellAboveViewer`), the viewer
 * hides and comes back with the shell's minimize/restore (`hideViewerWithShell`), and
 * closing the shell closes the viewer (index.ts). The window is still centred on the
 * shell's display.
 */
export function openViewer(next: ViewerRequest, parent: BrowserWindow | null): void {
  request = { ...next, index: clampIndex(next.index, next.items.length) }

  const existing = viewerWindow
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    // A plain window is not automatically above the shell: opening a photo again
    // has to bring it forward explicitly.
    existing.show()
    existing.moveTop()
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
    hiddenWithShell = false
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

/**
 * The conversation the open strip belongs to — 定位到聊天位置 hands the message id
 * back through `viewer:locate` and main pairs it with this chat.
 */
export function viewerChatId(): number | null {
  return request?.chatId ?? null
}

/**
 * The viewer is a plain window, so it no longer disappears with the shell on its
 * own. Minimizing the shell puts the picture away and restoring it brings it back
 * — the behaviour an owned window gives for free, spelled out because the task bar
 * grouping (one WeGram icon, two windows) needs an unowned window.
 */
let hiddenWithShell = false

export function hideViewerWithShell(): void {
  const win = getViewerWindow()
  if (!win || !win.isVisible()) return
  hiddenWithShell = true
  win.hide()
}

export function showViewerWithShell(): void {
  if (!hiddenWithShell) return
  hiddenWithShell = false
  getViewerWindow()?.show()
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
  repaintWindowChrome(getViewerWindow(), { overlay: titleBarOverlay(next) })
}

function createViewerWindow(parent: BrowserWindow | null): BrowserWindow {
  const display = displayForCursor(parent)
  const size = viewerWindowSize({
    screen: display.size,
    workArea: display.workAreaSize,
  })

  const win = createAppWindow({
    width: size.width,
    height: size.height,
    minWidth: VIEWER_MIN_W,
    minHeight: VIEWER_MIN_H,
    // The viewer paints its own toolbar into the title strip, like the shell.
    overlay: titleBarOverlay(theme),
    backgroundColor: theme === 'dark' ? '#242424' : '#f7f7f7',
    title: VIEWER_TITLE,
    hash: 'viewer',
  })

  // Centred inside the work area, like the client's viewer.
  centerOnDisplay(win, size, display)
  showWhenReady(win, { raise: true })

  // The viewer is a route of the same bundle; leaving it would strand the
  // toolbar and the strip it is showing (the shell and login windows guard this
  // the same way, and the viewer had been the one copy without it).
  attachNavigationPolicy(win, { links: 'deny', label: 'viewer' })

  return win
}

function titleBarOverlay(next: 'light' | 'dark'): {
  color: string
  symbolColor: string
  height: number
} {
  return {
    // Must match --wx-viewer-bar, or the strip reads as a seam.
    color: next === 'dark' ? '#3b3b3d' : '#e6e6e6',
    symbolColor: next === 'dark' ? '#b1b1b1' : '#191919',
    height: VIEWER_TOOLBAR_H,
  }
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(0, index), length - 1)
}
