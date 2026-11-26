import { contextBridge, ipcRenderer } from 'electron'

/**
 * The WebView-side half of a Mini App's `Telegram.WebApp` bridge (design doc
 * §9.4). Telegram's own `telegram-web-app.js` looks for exactly this global:
 *
 *   window.TelegramWebviewProxy.postEvent(eventType, JSON.stringify(eventData))
 *
 * It is defined before the page's scripts run (a preload does), so `ready()`,
 * `sendData()`, `close()`, `openLink()` and the rest of the SDK's event calls
 * arrive in main. Events *to* the page are not posted back through here; main
 * calls `Telegram.WebView.receiveEvent` in the page's world (see
 * `mini-app-window.ts`), which is the same door the official clients use.
 *
 * Only JSON strings cross: the remote page is untrusted input, and the length
 * caps keep a runaway script from stuffing megabytes into the main process. The
 * IPC channel itself is main-only; nothing in the host renderer can send it.
 */
const MAX_EVENT_LENGTH = 100_000
const MAX_EVENT_TYPE = 64

function postEvent(eventType: unknown, eventData: unknown): void {
  if (typeof eventType !== 'string') return
  const type = eventType.slice(0, MAX_EVENT_TYPE)
  let data = ''
  if (typeof eventData === 'string') data = eventData.slice(0, MAX_EVENT_LENGTH)
  else if (eventData !== undefined && eventData !== null) {
    try {
      data = JSON.stringify(eventData).slice(0, MAX_EVENT_LENGTH)
    } catch {
      return
    }
  }
  ipcRenderer.send('miniapp:event', { eventType: type, eventData: data })
}

contextBridge.exposeInMainWorld('TelegramWebviewProxy', { postEvent })
