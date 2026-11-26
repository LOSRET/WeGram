import { describe, expect, it, vi } from 'vitest'

import {
  handleMiniAppEvent,
  parseMiniAppEvent,
  parseMiniAppPopup,
  type MiniAppBridgeHost,
} from './mini-app-bridge'

/** A host that records every effect, so one event's surface is one assertion. */
function host() {
  const receive = vi.fn()
  const close = vi.fn()
  const sendData = vi.fn()
  const openExternal = vi.fn()
  const requestViewport = vi.fn()
  const setClosingConfirmation = vi.fn()
  const showPopup = vi.fn()
  const setupMainButton = vi.fn()
  const setupSecondaryButton = vi.fn()
  const setupBackButton = vi.fn()
  const setupSettingsButton = vi.fn()
  const setBottomBarColor = vi.fn()
  const invokeCustomMethod = vi.fn(async () => true)
  const biometryInfo = vi.fn(async () => ({
    available: false,
    type: 'unknown' as const,
    accessRequested: false,
    accessGranted: false,
    tokenSaved: false,
    deviceId: 'device-1',
  }))
  const biometryRequestAccess = vi.fn(async () => ({
    available: false,
    type: 'unknown' as const,
    accessRequested: true,
    accessGranted: false,
    tokenSaved: false,
    deviceId: 'device-1',
  }))
  const biometryAuthenticate = vi.fn(async () => ({ status: 'failed' as const }))
  const biometryUpdateToken = vi.fn(async () => ({ status: 'failed' as const }))
  const biometryOpenSettings = vi.fn()
  const unhandled = vi.fn()
  const bridge: MiniAppBridgeHost = {
    receive,
    close,
    sendData,
    theme: () => 'dark',
    openExternal,
    requestViewport,
    setClosingConfirmation,
    showPopup,
    setupMainButton,
    setupSecondaryButton,
    setupBackButton,
    setupSettingsButton,
    setBottomBarColor,
    invokeCustomMethod,
    biometryInfo,
    biometryRequestAccess,
    biometryAuthenticate,
    biometryUpdateToken,
    biometryOpenSettings,
    unhandled,
  }
  return {
    bridge,
    receive,
    close,
    sendData,
    openExternal,
    requestViewport,
    setClosingConfirmation,
    showPopup,
    setupMainButton,
    setupSecondaryButton,
    setupBackButton,
    setupSettingsButton,
    setBottomBarColor,
    invokeCustomMethod,
    biometryInfo,
    biometryRequestAccess,
    biometryAuthenticate,
    biometryUpdateToken,
    biometryOpenSettings,
    unhandled,
  }
}

/**
 * The guest bridge is untrusted input turned into a fixed set of host effects
 * (§9.4.1). These pin the parse (the preload's JSON string), each action, and
 * that an unknown event can never do more than be reported.
 */
describe('parseMiniAppEvent', () => {
  it('parses the preload payload and keeps an empty object for no data', () => {
    expect(parseMiniAppEvent({ eventType: 'web_app_close', eventData: '' })).toEqual({
      eventType: 'web_app_close',
      eventData: {},
    })
    expect(
      parseMiniAppEvent({ eventType: 'web_app_data_send', eventData: '{"data":"x"}' }),
    ).toEqual({ eventType: 'web_app_data_send', eventData: { data: 'x' } })
  })

  it('refuses a malformed envelope instead of guessing', () => {
    expect(parseMiniAppEvent(null)).toBeNull()
    expect(parseMiniAppEvent('web_app_close')).toBeNull()
    expect(parseMiniAppEvent({ eventType: '', eventData: '' })).toBeNull()
    expect(parseMiniAppEvent({ eventType: 'x', eventData: '{not json' })).toBeNull()
  })
})

describe('parseMiniAppPopup', () => {
  it('keeps up to three labelled buttons and falls back to one OK', () => {
    expect(
      parseMiniAppPopup({
        title: '确认',
        message: '继续吗？',
        buttons: [
          { id: 'yes', type: 'ok', text: '继续' },
          { id: 'no', type: 'cancel', text: '取消' },
          { id: 'x', type: 'destructive', text: '删除' },
          { id: 'fourth', type: 'default', text: '多余' },
        ],
      }),
    ).toEqual({
      title: '确认',
      message: '继续吗？',
      buttons: [
        { id: 'yes', type: 'ok', text: '继续' },
        { id: 'no', type: 'cancel', text: '取消' },
        { id: 'x', type: 'destructive', text: '删除' },
      ],
    })

    expect(parseMiniAppPopup({ message: '只有一句话' })?.buttons).toEqual([
      { id: 'ok', type: 'ok', text: '确定' },
    ])
  })

  it('refuses a popup with no message', () => {
    expect(parseMiniAppPopup({ message: '  ' })).toBeNull()
  })
})

describe('handleMiniAppEvent', () => {
  it('forwards native-button setup patches without treating them as clicks', () => {
    const h = host()
    handleMiniAppEvent('web_app_setup_main_button', { text: 'Save', is_visible: true }, h.bridge)
    handleMiniAppEvent(
      'web_app_setup_secondary_button',
      { text: 'Cancel', position: 'top' },
      h.bridge,
    )
    handleMiniAppEvent('web_app_setup_back_button', { is_visible: true }, h.bridge)
    handleMiniAppEvent('web_app_setup_settings_button', { is_visible: true }, h.bridge)
    handleMiniAppEvent('web_app_set_bottom_bar_color', { color: '#112233' }, h.bridge)

    expect(h.setupMainButton).toHaveBeenCalledWith({ text: 'Save', is_visible: true })
    expect(h.setupSecondaryButton).toHaveBeenCalledWith({ text: 'Cancel', position: 'top' })
    expect(h.setupBackButton).toHaveBeenCalledWith({ is_visible: true })
    expect(h.setupSettingsButton).toHaveBeenCalledWith({ is_visible: true })
    expect(h.setBottomBarColor).toHaveBeenCalledWith({ color: '#112233' })
    expect(h.receive).not.toHaveBeenCalled()
  })

  it('round-trips a CloudStorage custom method with its request id', async () => {
    const h = host()
    await handleMiniAppEvent(
      'web_app_invoke_custom_method',
      {
        req_id: 'storage-1',
        method: 'saveStorageValue',
        params: { key: 'theme', value: 'dark' },
      },
      h.bridge,
    )

    expect(h.invokeCustomMethod).toHaveBeenCalledWith(
      'saveStorageValue',
      '{"key":"theme","value":"dark"}',
    )
    expect(h.receive).toHaveBeenCalledWith('custom_method_invoked', {
      req_id: 'storage-1',
      result: true,
    })
  })

  it('refuses unknown custom methods without forwarding them', async () => {
    const h = host()
    await handleMiniAppEvent(
      'web_app_invoke_custom_method',
      { req_id: 'storage-2', method: 'deleteEverything', params: {} },
      h.bridge,
    )
    expect(h.invokeCustomMethod).not.toHaveBeenCalled()
    expect(h.receive).toHaveBeenCalledWith('custom_method_invoked', {
      req_id: 'storage-2',
      error: 'Invalid CloudStorage request',
    })
  })

  it('maps biometry info, auth and token results to the official events', async () => {
    const h = host()
    await handleMiniAppEvent('web_app_biometry_get_info', {}, h.bridge)
    expect(h.receive).toHaveBeenLastCalledWith('biometry_info_received', {
      available: false,
      type: 'unknown',
      access_requested: false,
      access_granted: false,
      token_saved: false,
      device_id: 'device-1',
    })

    await handleMiniAppEvent(
      'web_app_biometry_request_auth',
      { reason: '  Unlock the gallery  ' },
      h.bridge,
    )
    expect(h.biometryAuthenticate).toHaveBeenCalledWith('Unlock the gallery')
    expect(h.receive).toHaveBeenLastCalledWith('biometry_auth_requested', { status: 'failed' })

    await handleMiniAppEvent('web_app_biometry_update_token', { token: 'secret' }, h.bridge)
    expect(h.biometryUpdateToken).toHaveBeenCalledWith('secret')
    expect(h.receive).toHaveBeenLastCalledWith('biometry_token_updated', { status: 'failed' })
  })

  it('opens platform biometric settings without inventing a success response', () => {
    const h = host()
    handleMiniAppEvent('web_app_biometry_open_settings', {}, h.bridge)
    expect(h.biometryOpenSettings).toHaveBeenCalledOnce()
    expect(h.receive).not.toHaveBeenCalled()
  })

  it('answers a theme request with the current theme', () => {
    const h = host()
    handleMiniAppEvent('web_app_request_theme', {}, h.bridge)
    expect(h.receive).toHaveBeenCalledWith('theme_changed', {
      theme_params: expect.objectContaining({ bg_color: '#1e1e1f' }),
    })
  })

  it('closes, sends data and toggles the closing confirmation', () => {
    const h = host()
    handleMiniAppEvent('web_app_close', {}, h.bridge)
    handleMiniAppEvent('web_app_data_send', { data: '{"q":"x"}' }, h.bridge)
    handleMiniAppEvent('web_app_setup_closing_behavior', { need_confirmation: true }, h.bridge)
    expect(h.close).toHaveBeenCalledOnce()
    expect(h.sendData).toHaveBeenCalledWith('{"q":"x"}')
    expect(h.setClosingConfirmation).toHaveBeenCalledWith(true)
  })

  it('opens links and the native popup', () => {
    const h = host()
    handleMiniAppEvent('web_app_open_link', { url: 'https://example.com/x' }, h.bridge)
    handleMiniAppEvent('web_app_open_tg_link', { path_full: '/ada_lovelace/7' }, h.bridge)
    handleMiniAppEvent(
      'web_app_open_popup',
      { title: '确认', message: '继续吗？', buttons: [{ id: 'yes', type: 'ok', text: '继续' }] },
      h.bridge,
    )
    expect(h.openExternal).toHaveBeenNthCalledWith(1, 'https://example.com/x')
    expect(h.openExternal).toHaveBeenNthCalledWith(2, 'https://t.me/ada_lovelace/7')
    expect(h.showPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '继续吗？',
        buttons: [expect.objectContaining({ id: 'yes' })],
      }),
    )
  })

  it('reports an unknown event and does nothing else', () => {
    const h = host()
    handleMiniAppEvent('web_app_something_new', {}, h.bridge)
    expect(h.unhandled).toHaveBeenCalledWith('web_app_something_new')
    expect(h.close).not.toHaveBeenCalled()
    expect(h.sendData).not.toHaveBeenCalled()
  })
})
