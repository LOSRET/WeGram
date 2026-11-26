import type { BrowserWindow } from 'electron'

import type { ReportTarget, ReportWindowState } from '@wegram/protocol'
import { AppError } from '@wegram/protocol'

import {
  attachNavigationPolicy,
  centerOnDisplay,
  createAppWindow,
  displayForWindow,
  showWhenReady,
} from './app-window'

/**
 * 举报 as its own window (design doc §9.4.1).
 *
 * Two things forced this out of the shell. First, a Mini App is a window of its
 * own: a report sheet drawn inside the shell would open *behind* the app, so the
 * old flow had to close the app first — and closing it threw the page away even
 * when the reader only cancelled. Second, there is one 举报 flow (a bot from a
 * Mini App, a person's 资料卡, one message's menu) and it had better be one
 * surface, not one sheet per window that happens to open it.
 *
 * It is a frameless 380 × 560 sheet for the same reason 群二维码 is: the client's
 * sheets are small windows, not dialogs. The renderer half is
 * `screens/ReportWindow.tsx` through the `#report` hash; the window only learns
 * *what* is being reported (`report:state`) — the phased `reportChat` calls stay
 * the shell-independent `users:report` / `messages:report` channels.
 */
export const REPORT_WINDOW_W = 380
export const REPORT_WINDOW_H = 560

let reportWindow: BrowserWindow | null = null
let state: ReportWindowState | null = null

/**
 * Opens (or re-targets) the window. `parent` is the window that asked — the Mini
 * App for its ⋯ card, the shell for the 资料卡 and the message menu — so the
 * report always appears above the thing it was opened from.
 */
export function openReportWindow(
  target: ReportTarget,
  theme: 'light' | 'dark',
  parent: BrowserWindow | null,
): void {
  state = { target, theme }
  const existing = getReportWindow()
  if (existing) {
    // A reload is the whole re-target protocol, like the viewer's and the QR
    // window's: the renderer re-reads `report:state` on mount.
    existing.webContents.reload()
    existing.show()
    existing.moveTop()
    existing.focus()
    return
  }

  const win = createAppWindow({
    width: REPORT_WINDOW_W,
    height: REPORT_WINDOW_H,
    backgroundColor: theme === 'dark' ? '#1e1e1f' : '#fafafa',
    title: '举报',
    frameless: true,
    hash: 'report',
  })
  reportWindow = win
  win.on('closed', () => {
    if (reportWindow === win) reportWindow = null
    state = null
  })

  if (parent) win.setParentWindow(parent)
  centerOnDisplay(win, { width: REPORT_WINDOW_W, height: REPORT_WINDOW_H }, displayForWindow(parent))
  showWhenReady(win, { focus: true })

  // A report sheet is a dead end: it may not navigate anywhere or open a window.
  attachNavigationPolicy(win, { links: 'deny', label: 'report window' })
}

export function getReportWindow(): BrowserWindow | null {
  return reportWindow && !reportWindow.isDestroyed() ? reportWindow : null
}

/** What `report:state` answers; throws when the window is not open. */
export function reportWindowState(): ReportWindowState {
  if (!state) throw new AppError('internal', '举报窗口没有打开')
  return state
}

export function closeReportWindow(): void {
  getReportWindow()?.close()
}
