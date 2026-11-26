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

import type { MiniAppBiometryInfo } from './mini-app-biometry'
import {
  parseMiniAppCloudStorageRequest,
  parseMiniAppCloudStorageResult,
} from './mini-app-cloud-storage'
import { miniAppThemeParams } from './mini-app-theme'

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
  setupMainButton: (patch: Record<string, unknown>) => void
  setupSecondaryButton: (patch: Record<string, unknown>) => void
  setupBackButton: (patch: Record<string, unknown>) => void
  setupSettingsButton: (patch: Record<string, unknown>) => void
  setBottomBarColor: (patch: Record<string, unknown>) => void
  /** CloudStorage's reserved custom methods, forwarded through the adapter. */
  invokeCustomMethod: (method: string, parameters: string) => Promise<unknown>
  biometryInfo: () => Promise<MiniAppBiometryInfo>
  biometryRequestAccess: (reason?: string) => Promise<MiniAppBiometryInfo>
  biometryAuthenticate: (
    reason?: string,
  ) => Promise<{ status: 'authorized' | 'failed'; token?: string }>
  biometryUpdateToken: (token: string) => Promise<{ status: 'updated' | 'removed' | 'failed' }>
  biometryOpenSettings: () => void
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

/** One `web_app_*` event, dispatched to the effects the window owns. */
export function handleMiniAppEvent(
  eventType: string,
  data: Record<string, unknown>,
  host: MiniAppBridgeHost,
): void | Promise<void> {
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
        eventType === 'web_app_request_safe_area'
          ? 'safe_area_changed'
          : 'content_safe_area_changed',
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
      host.setupMainButton(data)
      return
    case 'web_app_setup_secondary_button':
      host.setupSecondaryButton(data)
      return
    case 'web_app_setup_back_button':
      host.setupBackButton(data)
      return
    case 'web_app_setup_settings_button':
      host.setupSettingsButton(data)
      return
    case 'web_app_set_bottom_bar_color':
      host.setBottomBarColor(data)
      return
    case 'web_app_set_header_color':
    case 'web_app_set_background_color':
    case 'web_app_set_bottom_bar_color':
    case 'web_app_invoke_custom_method':
      return invokeCloudStorage(data, host)
    case 'web_app_biometry_get_info':
      return sendBiometryInfo(host)
    case 'web_app_biometry_request_access':
      return requestBiometryAccess(host, data)
    case 'web_app_biometry_request_auth':
      return requestBiometryAuth(host, data)
    case 'web_app_biometry_update_token':
      return updateBiometryToken(host, data)
    case 'web_app_biometry_open_settings':
      host.biometryOpenSettings()
      return
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

/** CloudStorage is the only custom-method surface this client exposes. */
async function invokeCloudStorage(
  data: Record<string, unknown>,
  host: MiniAppBridgeHost,
): Promise<void> {
  const request = parseMiniAppCloudStorageRequest(data)
  if (!request) {
    const reqId = data['req_id']
    if (typeof reqId === 'string' && reqId.length > 0) {
      host.receive('custom_method_invoked', {
        req_id: reqId,
        error: 'Invalid CloudStorage request',
      })
    }
    return
  }
  try {
    const value = await host.invokeCustomMethod(request.method, request.parameters)
    const result = parseMiniAppCloudStorageResult(request.method, value)
    host.receive(
      'custom_method_invoked',
      result.ok
        ? { req_id: request.reqId, result: result.value }
        : { req_id: request.reqId, error: result.error },
    )
  } catch (error) {
    host.receive('custom_method_invoked', {
      req_id: request.reqId,
      error: error instanceof Error ? error.message : 'CloudStorage request failed',
    })
  }
}

async function sendBiometryInfo(host: MiniAppBridgeHost): Promise<void> {
  host.receive('biometry_info_received', biometryInfoPayload(await host.biometryInfo()))
}

async function requestBiometryAccess(
  host: MiniAppBridgeHost,
  data: Record<string, unknown>,
): Promise<void> {
  const info = await host.biometryRequestAccess(reasonOf(data))
  host.receive('biometry_info_received', biometryInfoPayload(info))
}

async function requestBiometryAuth(
  host: MiniAppBridgeHost,
  data: Record<string, unknown>,
): Promise<void> {
  host.receive('biometry_auth_requested', await host.biometryAuthenticate(reasonOf(data)))
}

async function updateBiometryToken(
  host: MiniAppBridgeHost,
  data: Record<string, unknown>,
): Promise<void> {
  const token = data['token']
  const result =
    typeof token === 'string' && token.length <= 1024
      ? await host.biometryUpdateToken(token)
      : { status: 'failed' as const }
  host.receive('biometry_token_updated', result)
}

function biometryInfoPayload(info: MiniAppBiometryInfo): Record<string, unknown> {
  return {
    available: info.available,
    type: info.type,
    access_requested: info.accessRequested,
    access_granted: info.accessGranted,
    token_saved: info.tokenSaved,
    device_id: info.deviceId,
  }
}

function reasonOf(data: Record<string, unknown>): string | undefined {
  const reason = data['reason']
  return typeof reason === 'string' ? reason.trim().slice(0, 128) || undefined : undefined
}
