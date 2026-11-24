import type { BrowserWindow } from 'electron'

import {
  attachNavigationPolicy,
  centerOnDisplay,
  createAppWindow,
  displayForWindow,
  showWhenReady,
} from './app-window'

/**
 * 群二维码 opens as its own small window, like WeChat's: a frameless 360 × 560
 * sheet centred on the shell, carrying the group's face, its QR code, the validity
 * line and the three actions (转发给朋友 / 复制图片 / 保存图片).
 *
 * It is a **child** of the shell on purpose — unlike the viewer. A QR is opened
 * from the conversation it belongs to and closes with it; the client keeps it on
 * top of 微信 the same way. The renderer half is `screens/QrWindow.tsx`, loaded
 * through the `#qr` hash of the same bundle.
 *
 * Design: docs/技术方案.md §9.9.
 */
export const QR_WINDOW_W = 360
export const QR_WINDOW_H = 560

const QR_TITLE = '群二维码'

let qrWindow: BrowserWindow | null = null
/** The chat the open window draws; `qr:info` reads it. */
let target: number | null = null

export function openQrWindow(
  chatId: number,
  theme: 'light' | 'dark',
  parent: BrowserWindow | null,
): void {
  target = chatId
  const existing = getQrWindow()
  if (existing) {
    // A reload is the whole re-target protocol, like the viewer's: the renderer
    // re-reads `qr:info` on mount and that answers for the new chat.
    existing.webContents.reload()
    existing.show()
    existing.moveTop()
    existing.focus()
    return
  }

  const win = createAppWindow({
    width: QR_WINDOW_W,
    height: QR_WINDOW_H,
    // The client's sheet is #fafafa; the dark theme keeps the shell's pane.
    backgroundColor: theme === 'dark' ? '#1e1e1f' : '#fafafa',
    title: QR_TITLE,
    frameless: true,
    hash: 'qr?chat=' + chatId,
  })
  qrWindow = win
  win.on('closed', () => {
    if (qrWindow === win) qrWindow = null
    if (target === chatId) target = null
  })

  if (parent) win.setParentWindow(parent)
  centerOnDisplay(win, { width: QR_WINDOW_W, height: QR_WINDOW_H }, displayForWindow(parent))
  showWhenReady(win, { focus: true })

  // A QR sheet is a dead end: it may not navigate anywhere or open a new window.
  attachNavigationPolicy(win, { links: 'deny', label: 'qr window' })
}

export function getQrWindow(): BrowserWindow | null {
  return qrWindow && !qrWindow.isDestroyed() ? qrWindow : null
}

/** The chat the QR window currently represents; `null` when it is closed. */
export function qrTarget(): number | null {
  return target
}

export function closeQrWindow(): void {
  getQrWindow()?.close()
}
