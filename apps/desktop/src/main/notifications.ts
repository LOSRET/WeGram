import { BrowserWindow, Notification } from 'electron'

import { createLogger } from './util'

const logger = createLogger('notifications')

export interface NotificationTarget {
  chatId: number
  messageId: number
  title: string
  text: string
  isSilent: boolean
  date: number
}

export interface NotificationCenterOptions {
  /** The shell window, if it currently exists. */
  getShellWindow: () => BrowserWindow | null
  /** Raise the shell and open the chat at the message the reader clicked. */
  onOpen: (target: { chatId: number; messageId: number }) => void
}

/** Newest-first cap: a burst must not leave a stack of stale toasts behind. */
const MAX_LIVE = 5

/**
 * Desktop notifications, driven by TDLib's own notification stream.
 *
 * Deriving them from `updateNewMessage` was the tempting shortcut and the wrong
 * one: TDLib already applies the chat's mute settings, mention rules and preview
 * privacy, and a hand-rolled filter drifts from the official client. The adapter
 * forwards `notificationTypeNewMessage` objects, and this class owns the OS part.
 *
 * Suppression: a notification for the conversation the reader is looking at, in a
 * focused window, is noise — the transcript already shows it and the read marker
 * moves on its own. Everywhere else (another chat, minimized, behind another app)
 * it is announced, and the window flashes until it gets focus.
 */
export class NotificationCenter {
  /** The conversation the shell shows; reported by the renderer. */
  private activeChatId: number | null = null
  private readonly live = new Set<Notification>()

  constructor(private readonly options: NotificationCenterOptions) {}

  setActiveChat(chatId: number | null): void {
    this.activeChatId = chatId
  }

  notify(target: NotificationTarget): void {
    if (!target.title && !target.text) return
    const shell = this.options.getShellWindow()
    const shellReady = shell !== null && !shell.isDestroyed()
    const focused =
      shellReady && shell.isFocused() && shell.isVisible() && !shell.isMinimized()
    if (focused && this.activeChatId === target.chatId) return

    // The taskbar is the fallback signal on a machine where toasts are disabled.
    if (shellReady && !focused) shell.flashFrame(true)

    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: target.title || 'WeGram',
      body: target.text,
      silent: target.isSilent,
    })
    this.live.add(notification)
    while (this.live.size > MAX_LIVE) {
      const oldest = this.live.values().next().value
      if (!oldest) break
      this.live.delete(oldest)
      oldest.close()
    }
    notification.on('click', () => {
      this.live.delete(notification)
      this.options.onOpen({ chatId: target.chatId, messageId: target.messageId })
    })
    notification.on('close', () => this.live.delete(notification))
    notification.on('failed', (_event, error) => {
      this.live.delete(notification)
      logger.warn('notification failed:', error)
    })
    notification.show()
  }

  dispose(): void {
    for (const notification of this.live) notification.close()
    this.live.clear()
  }
}
