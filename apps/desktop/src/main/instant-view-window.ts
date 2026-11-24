import type { InstantViewTarget, InstantViewWindowState } from '@wegram/protocol'
import { AppError } from '@wegram/protocol'
import { BrowserWindow, screen } from 'electron'

import { attachNavigationPolicy, createAppWindow } from './app-window'

/** Height of the strip the window controls sit in; the renderer draws it. */
const READER_BAR_H = 40

/**
 * 即时预览's reader window (design doc §8.9), like the client's own Instant View
 * window: a top-level window of its own, not a sheet over the transcript.
 *
 * It is a route of the same bundle (`#instantview`) and a plain top-level window
 * on purpose — the task bar then shows one WeGram button for the shell and its
 * windows, exactly the way 图片和视频 works. What the window needs is one target
 * (the link and the preview's words), which the shell hands over through
 * `web:open`; re-targeting an open window reloads it, and the page itself is
 * fetched by the window through `web:instantView`.
 */

let readerWindow: BrowserWindow | null = null
let target: InstantViewTarget | null = null
let theme: 'light' | 'dark' = 'light'

/** The window's own name: the OS draws it in the frame and the task bar. */
const READER_TITLE = '即时预览'

export function openInstantViewWindow(next: InstantViewTarget, parent: BrowserWindow | null): void {
  target = next

  const existing = getInstantViewWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    // A plain window is not automatically above the shell: opening another link
    // has to bring it forward explicitly.
    existing.show()
    existing.moveTop()
    existing.focus()
    // The window keeps no state worth merging: a reload re-reads `web:state`,
    // which is the whole re-target protocol (the viewer does the same).
    existing.webContents.reload()
    return
  }

  const win = createReaderWindow(parent)
  readerWindow = win
  win.on('closed', () => {
    readerWindow = null
    target = null
  })
}

export function getInstantViewWindow(): BrowserWindow | null {
  return readerWindow && !readerWindow.isDestroyed() ? readerWindow : null
}

/** What `web:state` answers. Only the reader window calls it. */
export function instantViewWindowState(): InstantViewWindowState {
  if (!target) throw new AppError('internal', '即时预览窗口没有打开任何链接')
  return { ...target, theme }
}

/**
 * The app theme follows 设置 (and the OS in 跟随系统). A framed window's title bar
 * is painted by Windows; the renderer repaints itself from `evt:theme`, so this
 * only keeps the next `web:state` answer honest.
 */
export function setInstantViewTheme(next: 'light' | 'dark'): void {
  theme = next
  const win = getInstantViewWindow()
  if (!win) return
  try {
    win.setTitleBarOverlay(titleBarOverlay(next))
    win.setBackgroundColor(next === 'dark' ? '#1e1e1f' : '#fafafa')
  } catch {
    // A window that is mid-teardown refuses the call; nothing to repaint then.
  }
}

export function closeInstantViewWindow(): void {
  readerWindow?.close()
}

function titleBarOverlay(next: 'light' | 'dark'): {
  color: string
  symbolColor: string
  height: number
} {
  return {
    // Must match --wx-iv-win-bar in styles/instant-view.css.
    color: next === 'dark' ? '#2f2f30' : '#f2f2f2',
    symbolColor: next === 'dark' ? '#b1b1b1' : '#191919',
    height: READER_BAR_H,
  }
}

function createReaderWindow(parent: BrowserWindow | null): BrowserWindow {
  const display = parent
    ? screen.getDisplayMatching(parent.getBounds())
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  // A reading column, not a phone sheet: the client's IV window is roughly this,
  // and it keeps 640 px of text plus the page's margins comfortable.
  const width = Math.min(900, Math.max(560, Math.round(area.width * 0.46)))
  const height = Math.min(940, Math.max(520, Math.round(area.height * 0.84)))

  const win = createAppWindow({
    width,
    height,
    minWidth: 480,
    minHeight: 400,
    // The reader paints its own 40 px strip into the title area, exactly like the
    // viewer: that is what removes the default application menu bar (a framed
    // window shows File/Edit/View/Window) and lets the strip follow the theme.
    overlay: titleBarOverlay(theme),
    backgroundColor: theme === 'dark' ? '#1e1e1f' : '#fafafa',
    title: READER_TITLE,
    hash: 'instantview',
  })
  // Belt and braces: no menu, and no Alt key that summons one.
  win.setMenu(null)
  win.setMenuBarVisibility(false)

  win.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  })

  win.once('ready-to-show', () => {
    win.show()
    // Nothing owns this window, so it raises and focuses itself.
    win.moveTop()
    win.focus()
  })

  // The page is a web article: an external link leaves the app, and the article may
  // never navigate this window away from its own route.
  attachNavigationPolicy(win, { links: 'open-external', label: 'reader' })

  return win
}
