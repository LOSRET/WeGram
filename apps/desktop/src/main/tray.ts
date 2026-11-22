import { app, Menu, nativeImage, Tray } from 'electron'

import { TRAY_ICON_DATA_URL } from './tray-icon'
import { createLogger } from './util'

const logger = createLogger('tray')

let tray: Tray | null = null

export interface TrayOptions {
  /** Brings the app forward: the shell if it exists, the login window otherwise. */
  onOpen: () => void
}

/**
 * Windows notification-area icon.
 *
 * Closing the shell still quits the app (unchanged in this batch), so the tray is
 * a shortcut back to a minimized window rather than a "keep running" switch: 打开
 * WeGram raises whatever window the app lives in, 退出 quits like File → Exit.
 */
export function createTray(options: TrayOptions): void {
  if (tray) return
  const image = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  if (image.isEmpty()) {
    logger.warn('tray icon could not be decoded; running without a tray icon')
    return
  }
  try {
    const next = new Tray(image)
    next.setToolTip('WeGram')
    next.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开 WeGram', click: options.onOpen },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    )
    next.on('click', options.onOpen)
    next.on('double-click', options.onOpen)
    tray = next
  } catch (error) {
    // Some Windows sessions have no notification area for the process (a service
    // window station, a locked desktop). A missing tray must not keep the app
    // from starting — the shell is still reachable.
    logger.warn(
      'tray icon unavailable:',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
