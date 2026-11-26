import { describe, expect, it } from 'vitest'

import type { TdObject } from '../client'
import { closeMiniApp, invokeMiniAppCustomRequest, openMiniApp, sendMiniAppData } from './webapp'

/**
 * Mini Apps are four surfaces over three TDLib calls (§9.4). These pin which
 * call each surface makes, that the signed URL stays the one TDLib answered, and
 * that a launch id is released exactly as `openWebApp` handed it over.
 */
function fakeDeps(answer: (method: TdObject) => unknown) {
  const calls: TdObject[] = []
  return {
    calls,
    deps: {
      invoke: async (method: TdObject): Promise<unknown> => {
        calls.push(method)
        if (method._ === 'getUser') {
          return {
            id: 26,
            first_name: 'WeGram',
            last_name: '助手',
            type: { _: 'userTypeBot' },
          }
        }
        return answer(method)
      },
    },
  }
}

describe('openMiniApp', () => {
  it('asks getWebAppUrl for a reply-keyboard key', async () => {
    const { calls, deps } = fakeDeps((method) => {
      if (method._ === 'getWebAppUrl') return { url: 'https://app.test/#tgWebAppData=x' }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await expect(
      openMiniApp(
        deps,
        {
          source: 'keyboard',
          chatId: 13,
          botUserId: 26,
          url: 'https://app.test/',
          buttonText: '首页',
        },
        'light',
      ),
    ).resolves.toEqual({
      title: 'WeGram 助手',
      botUserId: 26,
      url: 'https://app.test/#tgWebAppData=x',
    })

    expect(calls.map((call) => call._)).toEqual(['getUser', 'getWebAppUrl'])
    expect(calls[1]).toMatchObject({
      bot_user_id: 26,
      url: 'https://app.test/',
      parameters: {
        _: 'webAppOpenParameters',
        application_name: 'tdesktop',
        theme: {
          _: 'themeParameters',
          background_color: 0xffffff,
          button_color: 0x07c160,
        },
      },
    })
  })

  it('asks openWebApp for an inline button and keeps its launch id', async () => {
    const { calls, deps } = fakeDeps((method) => {
      if (method._ === 'openWebApp') {
        return { launch_id: '100', url: { url: 'https://app.test/inline#tgWebAppData=x' } }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await expect(
      openMiniApp(
        deps,
        {
          source: 'inline',
          chatId: 13,
          botUserId: 26,
          url: 'https://app.test/inline',
          buttonText: '打开',
        },
        'dark',
      ),
    ).resolves.toEqual({
      title: 'WeGram 助手',
      botUserId: 26,
      url: 'https://app.test/inline#tgWebAppData=x',
      launchId: '100',
    })
    expect(calls[1]).toMatchObject({
      _: 'openWebApp',
      chat_id: 13,
      bot_user_id: 26,
      url: 'https://app.test/inline',
      parameters: {
        application_name: 'tdesktop',
        theme: { _: 'themeParameters', background_color: 0x1e1e1f },
      },
    })
  })

  it('resolves a t.me web app link through searchPublicChat + getWebAppLinkUrl', async () => {
    const { calls, deps } = fakeDeps((method) => {
      if (method._ === 'searchPublicChat') {
        return { id: 13, type: { _: 'chatTypePrivate', user_id: 26 } }
      }
      if (method._ === 'getWebAppLinkUrl') {
        return { url: 'https://app.test/link#tgWebAppData=y' }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await expect(
      openMiniApp(
        deps,
        {
          source: 'link',
          username: '@wegram_helper',
          shortName: 'app',
          startParameter: 'invite_7',
        },
        'light',
      ),
    ).resolves.toEqual({
      title: 'WeGram 助手',
      botUserId: 26,
      url: 'https://app.test/link#tgWebAppData=y',
    })
    expect(calls[0]).toEqual({ _: 'searchPublicChat', username: 'wegram_helper' })
    expect(calls[2]).toMatchObject({
      _: 'getWebAppLinkUrl',
      chat_id: 13,
      bot_user_id: 26,
      web_app_short_name: 'app',
      start_parameter: 'invite_7',
      allow_write_access: false,
      parameters: {
        application_name: 'tdesktop',
        theme: { _: 'themeParameters', background_color: 0xffffff },
      },
    })
  })

  it('resolves a menu button that names a t.me web app link', async () => {
    const { calls, deps } = fakeDeps((method) => {
      if (method._ === 'getWebAppLinkUrl') {
        return { url: 'https://app.test/menu#tgWebAppData=z' }
      }
      throw new Error(`unexpected ${String(method._)}`)
    })

    await expect(
      openMiniApp(
        deps,
        {
          source: 'menu',
          botUserId: 26,
          chatId: 13,
          url: 'https://t.me/wegram_helper/app?startapp=home',
          buttonText: '打开小程序',
        },
        'light',
      ),
    ).resolves.toEqual({
      title: 'WeGram 助手',
      botUserId: 26,
      url: 'https://app.test/menu#tgWebAppData=z',
    })
    expect(calls[1]).toMatchObject({
      _: 'getWebAppLinkUrl',
      chat_id: 13,
      bot_user_id: 26,
      web_app_short_name: 'app',
      start_parameter: 'home',
      allow_write_access: false,
    })
  })

  it('refuses a page URL that is not HTTPS', async () => {
    const { deps } = fakeDeps((method) => {
      if (method._ === 'openWebApp') return { launch_id: '1', url: { url: 'http://app.test' } }
      throw new Error(`unexpected ${String(method._)}`)
    })
    await expect(
      openMiniApp(
        deps,
        {
          source: 'menu',
          botUserId: 26,
          url: 'https://app.test',
          buttonText: '首页',
        },
        'light',
      ),
    ).rejects.toMatchObject({ code: 'tdlib_error' })
  })

  it('refuses a button that belongs to somebody who is not a bot', async () => {
    const deps = {
      invoke: async (method: TdObject): Promise<unknown> => {
        if (method._ === 'getUser') {
          return { id: 26, first_name: 'Ada', type: { _: 'userTypeRegular' } }
        }
        throw new Error(`unexpected ${String(method._)}`)
      },
    }
    await expect(
      openMiniApp(
        deps,
        {
          source: 'keyboard',
          chatId: 13,
          botUserId: 26,
          url: 'https://app.test',
          buttonText: '首页',
        },
        'light',
      ),
    ).rejects.toMatchObject({ code: 'invalid_payload' })
  })
})

describe('invokeMiniAppCustomRequest', () => {
  it('forwards a CloudStorage method and decodes TDLib JSON text', async () => {
    const { calls, deps } = fakeDeps(() => ({ result: '{"theme":"dark"}' }))
    await expect(
      invokeMiniAppCustomRequest(deps, {
        botUserId: 26,
        method: 'getStorageValues',
        parameters: '{"keys":["theme"]}',
      }),
    ).resolves.toEqual({ theme: 'dark' })
    expect(calls).toEqual([
      {
        _: 'sendWebAppCustomRequest',
        bot_user_id: 26,
        method: 'getStorageValues',
        parameters: '{"keys":["theme"]}',
      },
    ])
  })

  it('refuses a non-JSON custom-request result', async () => {
    const { deps } = fakeDeps(() => ({ result: 'not json' }))
    await expect(
      invokeMiniAppCustomRequest(deps, {
        botUserId: 26,
        method: 'getStorageKeys',
        parameters: '{}',
      }),
    ).rejects.toMatchObject({ code: 'tdlib_error' })
  })
})

describe('closeMiniApp', () => {
  it('releases a numeric launch id and ignores a missing one', async () => {
    const { calls, deps } = fakeDeps((method) => {
      if (method._ === 'closeWebApp') return {}
      throw new Error(`unexpected ${String(method._)}`)
    })
    await closeMiniApp(deps, '123')
    await closeMiniApp(deps)
    await closeMiniApp(deps, 'not-an-id')
    expect(calls).toEqual([{ _: 'closeWebApp', web_app_launch_id: '123' }])
  })
})

describe('sendMiniAppData', () => {
  it('posts WebApp.sendData with the button that opened the app', async () => {
    const { calls, deps } = fakeDeps((method) => {
      if (method._ === 'sendWebAppData') return {}
      throw new Error(`unexpected ${String(method._)}`)
    })
    await sendMiniAppData(deps, { botUserId: 26, buttonText: '首页', data: '{"q":"x"}' })
    expect(calls).toEqual([
      { _: 'sendWebAppData', bot_user_id: 26, button_text: '首页', data: '{"q":"x"}' },
    ])
  })
})
