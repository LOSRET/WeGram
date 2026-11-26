/**
 * The guest half of the Mini App bridge (design doc §9.4.1).
 *
 * `telegram-web-app.js` posts every `Telegram.WebApp` call through
 * `window.TelegramWebviewProxy.postEvent(type, JSON.stringify(data))`; this
 * module turns that untrusted pair into the handful of actions the client
 * performs, and nothing else. It imports no Electron: the window module supplies
 * the effects (close, sendData, theme, popup, openExternal), which keeps the
 * event table testable and makes it obvious that the signed URL is not here.
 */

export interface MiniAppPopupButton {
  /** Opaque to the client; handed back in `popup_closed.button_id`. */
  id: string
  type: string
  text: string
}

export interface MiniAppPopup {
  title: string
  message: string
  buttons: MiniAppPopupButton[]
}

/** What the window must do when the page speaks. */
export interface MiniAppBridgeHost {
  /** Main -> page, through `Telegram.WebView.receiveEvent`. */
  receive: (eventType: string, eventData: unknown) => void
  close: () => void
  /** One `WebApp.sendData` payload. */
  sendData: (data: string) => void
  theme: () => 'light' | 'dark'
  openExternal: (url: string) => void
  /** The viewport is owned by the window, not by this module. */
  requestViewport: () => void
  setClosingConfirmation: (needed: boolean) => void
  showPopup: (popup: MiniAppPopup) => void
  /** An event this bridge does not implement (logged once per call). */
  unhandled: (eventType: string) => void
}

/** The event + JSON payload a preload sent; null for anything malformed. */
export function parseMiniAppEvent(
  raw: unknown,
): { eventType: string; eventData: Record<string, unknown> } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as { eventType?: unknown; eventData?: unknown }
  if (typeof record.eventType !== 'string' || !record.eventType) return null
  let data: Record<string, unknown> = {}
  if (typeof record.eventData === 'string' && record.eventData) {
    try {
      const parsed: unknown = JSON.parse(record.eventData)
      if (typeof parsed === 'object' && parsed !== null) {
        data = parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return { eventType: record.eventType, eventData: data }
}

/** `WebApp.showPopup`: title / message / up to three buttons, ids opaque. */
export function parseMiniAppPopup(data: Record<string, unknown>): MiniAppPopup | null {
  const message = typeof data.message === 'string' ? data.message.trim() : ''
  if (!message) return null
  const title = typeof data.title === 'string' ? data.title.trim() : ''
  const raw = Array.isArray(data.buttons) ? data.buttons : []
  const buttons: MiniAppPopupButton[] = []
  for (const item of raw.slice(0, 3)) {
    if (typeof item !== 'object' || item === null) continue
    const button = item as { id?: unknown; type?: unknown; text?: unknown }
    if (typeof button.id !== 'string' || typeof button.text !== 'string') continue
    buttons.push({
      id: button.id,
      type: typeof button.type === 'string' ? button.type : '',
      text: button.text.trim() || '确定',
    })
  }
  // A popup with no usable button is still a dialog the page waits on: give it
  // the one button that closes it, or `popup_closed` could never arrive.
  if (!buttons.length) buttons.push({ id: 'ok', type: 'ok', text: '确定' })
  return { title, message, buttons }
}

/**
 * Telegram's theme keys, from the app's own colours. The page paints its
 * buttons and backgrounds from these (`WebApp.themeParams`), so a dark WeGram
 * does not hand a mini app a white sheet.
 */
export function miniAppThemeParams(theme: 'light' | 'dark'): Record<string, string> {
  return theme === 'dark'
    ? {
        bg_color: '#1e1e1f',
        secondary_bg_color: '#2b2b2c',
        text_color: '#e7e7e7',
        hint_color: '#9a9a9a',
        link_color: '#7cc4ff',
        button_color: '#2ea6ff',
        button_text_color: '#ffffff',
      }
    : {
        bg_color: '#ffffff',
        secondary_bg_color: '#f5f5f5',
        text_color: '#191919',
        hint_color: '#999999',
        link_color: '#2481cc',
        button_color: '#07c160',
        button_text_color: '#ffffff',
      }
}

/** One `web_app_*` event, dispatched to the effects the window owns. */
export function handleMiniAppEvent(
  eventType: string,
  data: Record<string, unknown>,
  host: MiniAppBridgeHost,
): void {
  switch (eventType) {
    case 'web_app_ready':
      return
    case 'web_app_expand':
    case 'web_app_request_fullscreen':
    case 'web_app_exit_fullscreen':
      // The window is already the whole app: there is no compact/full state.
      return
    case 'web_app_request_theme':
      host.receive('theme_changed', { theme_params: miniAppThemeParams(host.theme()) })
      return
    case 'web_app_request_viewport':
      host.requestViewport()
      return
    case 'web_app_request_safe_area':
    case 'web_app_request_content_safe_area':
      // No notch in a desktop window.
      host.receive(
        eventType === 'web_app_request_safe_area' ? 'safe_area_changed' : 'content_safe_area_changed',
        { top: 0, bottom: 0, left: 0, right: 0 },
      )
      return
    case 'web_app_setup_closing_behavior':
      host.setClosingConfirmation(data.need_confirmation === true)
      return
    case 'web_app_close':
      host.close()
      return
    case 'web_app_data_send': {
      const text = typeof data.data === 'string' ? data.data : ''
      if (text) host.sendData(text)
      return
    }
    case 'web_app_open_popup': {
      const popup = parseMiniAppPopup(data)
      if (popup) host.showPopup(popup)
      return
    }
    case 'web_app_open_link': {
      const url = typeof data.url === 'string' ? data.url : ''
      if (url) host.openExternal(url)
      return
    }
    case 'web_app_open_tg_link': {
      const path = typeof data.path_full === 'string' ? data.path_full : ''
      if (path.startsWith('/')) host.openExternal(`https://t.me${path}`)
      return
    }
    case 'web_app_setup_main_button':
    case 'web_app_setup_secondary_button':
    case 'web_app_setup_back_button':
    case 'web_app_setup_settings_button':
    case 'web_app_set_header_color':
    case 'web_app_set_background_color':
    case 'web_app_set_bottom_bar_color':
    case 'web_app_setup_swipe_behavior':
    case 'web_app_trigger_haptic_feedback':
    case 'web_app_toggle_orientation_lock':
      // Styling and native-button requests this client has no surface for yet.
      // They are ignored, not answered: the SDK's defaults stay usable.
      return
    default:
      host.unhandled(eventType)
  }
}
