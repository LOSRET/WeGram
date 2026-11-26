import { describe, expect, it, vi } from 'vitest'

import {
  handleMiniAppEvent,
  miniAppThemeParams,
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

describe('miniAppThemeParams', () => {
  it('turns the app theme into the SDK colour keys', () => {
    expect(miniAppThemeParams('dark')).toMatchObject({
      bg_color: '#1e1e1f',
      button_color: '#2ea6ff',
    })
    expect(miniAppThemeParams('light')).toMatchObject({
      bg_color: '#ffffff',
      button_color: '#07c160',
    })
  })
})

describe('handleMiniAppEvent', () => {
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
      expect.objectContaining({ message: '继续吗？', buttons: [expect.objectContaining({ id: 'yes' })] }),
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
