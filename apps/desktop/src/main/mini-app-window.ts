import { join } from 'node:path'

import type { MiniAppPressRequest, MiniAppState } from '@wegram/protocol'
import { AppError } from '@wegram/protocol'
import { BrowserWindow, dialog, ipcMain, Menu, shell, WebContentsView } from 'electron'

import {
  centerOnDisplay,
  createAppWindow,
  displayForCursor,
  repaintWindowChrome,
  showWhenReady,
} from './app-window'
import {
  handleMiniAppEvent,
  parseMiniAppEvent,
  type MiniAppBridgeHost,
  type MiniAppPopup,
} from './mini-app-bridge'
import {
  applyBottomBarColor,
  applyBottomButtonPatch,
  applyVisibilityPatch,
  defaultMiniAppControls,
  withActionBarHeight,
} from './mini-app-controls'
import type { MiniAppBiometryService } from './mini-app-biometry'
import { miniAppThemeParams } from './mini-app-theme'
import { createLogger } from './util'

const logger = createLogger('miniapp')

/** Height of the strip the window draws itself; the guest starts below it. */
const MINI_APP_BAR_H = 48
/** The official client's Web App sheet is phone-ish; this is the desktop measure. */
const WINDOW_WIDTH = 560
const WINDOW_HEIGHT = 780

const TELEGRAM_TERMS = 'https://telegram.org/tos'
const TELEGRAM_PRIVACY = 'https://telegram.org/privacy'

export interface MiniAppWindowTarget {
  /** The bot's display name: the window's title and its strip. */
  title: string
  /** The signed URL TDLib answered; it never crosses IPC. */
  url: string
  /** TDLib `openWebApp.launch_id`, released when the window goes away. */
  launchId?: string
  /** Whose Mini App this is: `WebApp.sendData`, storage and 举报 need it. */
  botUserId: number
  /** The signed-in account; storage and biometric tokens are user-scoped. */
  userId: number
  /** The button that opened it: TDLib `sendWebAppData.button_text`. */
  buttonText: string
}

export interface MiniAppWindowDeps {
  theme: 'light' | 'dark'
  /** `closeWebApp` for a launch that went through `openWebApp`. */
  releaseLaunch: (launchId?: string) => Promise<void>
  /** Posts `WebApp.sendData` back to the bot (`sendWebAppData`). */
  sendData: (input: { botUserId: number; buttonText: string; data: string }) => Promise<void>
  /** CloudStorage's reserved methods through TDLib's custom-request seam. */
  invokeCustomMethod: (input: {
    botUserId: number
    method: string
    parameters: string
  }) => Promise<unknown>
  /** Windows Hello consent, verification and DPAPI-sealed token storage. */
  biometry: MiniAppBiometryService
  /** 举报 from the ⋮ menu: the shell opens its own report sheet. */
  onReport: (userId: number) => void
}

interface OpenTarget {
  target: MiniAppWindowTarget
  theme: 'light' | 'dark'
}

let miniAppWindow: BrowserWindow | null = null
/** The guest web view; a re-target replaces it (a browser tab, not a new window). */
let guest: WebContentsView | null = null
let opened: OpenTarget | null = null
let deps: MiniAppWindowDeps | null = null
/** `WebApp.setClosingConfirmation`: the ×/Alt+F4 asks before it discards state. */
let confirmsClosing = false
let confirming = false
/** Native chrome requested by the current guest; a new launch resets it. */
let controls = defaultMiniAppControls()
let controlsSeq = 0
/** Invalidates async popup/storage/biometry responses across retarget and reload. */
let miniAppSession = 0
/** Set while `closeMiniAppWindow` tears the window down, so `close` skips the prompt. */
let forceClosing = false

/**
 * The Mini App window (design doc §9.4): a bot's Web App in a web view of its own,
 * with the client's strip above it — title, ⋮ and ×, exactly the official client's
 * arrangement.
 *
 * The guest is a `WebContentsView`, not an iframe: a Mini App may not be frameable
 * (CSP / X-Frame-Options), and the page is untrusted, so it gets its own sandboxed
 * web contents with a preload that exposes *only* `TelegramWebviewProxy`. The
 * signed URL (which carries the account's `tgWebAppData`) lives in main; the strip
 * renderer's `#miniapp` route only learns the bot's name and the theme.
 *
 * One window exists at a time, like the official client: opening another Mini App
 * replaces the guest and releases the previous `launch_id`.
 */
export function openMiniAppWindow(target: MiniAppWindowTarget, next: MiniAppWindowDeps): void {
  deps = next
  // A new page has its own closing behaviour; the previous app's must not leak.
  confirmsClosing = false
  confirming = false
  controls = defaultMiniAppControls()
  controlsSeq = 0
  miniAppSession += 1
  const previous = opened
  opened = { target, theme: next.theme }

  const existing = getMiniAppWindow()
  if (existing) {
    // A new app, not a reload: TDLib must release the launch the old guest held.
    if (previous?.target.launchId) {
      void next.releaseLaunch(previous.target.launchId).catch((error: unknown) => {
        logger.warn(
          'releasing the previous launch failed:',
          error instanceof Error ? error.message : error,
        )
      })
    }
    destroyGuest()
    existing.setTitle(target.title)
    repaintWindowChrome(existing, {
      background: next.theme === 'dark' ? '#1e1e1f' : '#fafafa',
    })
    createGuest(existing)
    layoutGuest(existing)
    // The strip's title comes from `miniapp:init`; re-asking is one reload.
    existing.webContents.reload()
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.moveTop()
    existing.focus()
    return
  }

  const display = displayForCursor(null)
  const area = display.workArea
  const width = Math.min(WINDOW_WIDTH, Math.max(380, area.width - 80))
  const height = Math.min(WINDOW_HEIGHT, Math.max(480, area.height - 60))
  const win = createAppWindow({
    width,
    height,
    minWidth: 360,
    minHeight: 480,
    frameless: true,
    // Unlike the login sheet, a Mini App is a browser-like window: the page may
    // be a dashboard, and shrinking it to one phone size would be a promise the
    // window cannot keep.
    resizable: true,
    backgroundColor: next.theme === 'dark' ? '#1e1e1f' : '#fafafa',
    title: target.title,
    hash: 'miniapp',
  })
  win.setMenu(null)
  win.setMenuBarVisibility(false)
  miniAppWindow = win

  centerOnDisplay(win, { width, height }, display)
  win.on('resize', () => {
    layoutGuest(win)
    sendViewport(win)
  })
  win.on('close', (event) => {
    if (forceClosing || !confirmsClosing) return
    event.preventDefault()
    if (confirming) return
    confirming = true
    void dialog
      .showMessageBox(win, {
        type: 'question',
        title: '关闭小程序',
        buttons: ['关闭', '取消'],
        defaultId: 1,
        cancelId: 1,
        message: '要关闭小程序吗？',
        detail: '小程序可能还没有保存当前内容。',
      })
      .then(({ response }) => {
        confirming = false
        if (response !== 0) return
        confirmsClosing = false
        miniAppWindow?.close()
      })
      .catch((error: unknown) => {
        confirming = false
        logger.warn('closing prompt failed:', error instanceof Error ? error.message : error)
      })
  })
  win.on('closed', () => {
    const launchId = opened?.target.launchId
    const release = deps?.releaseLaunch
    miniAppWindow = null
    opened = null
    deps = null
    miniAppSession += 1
    forceClosing = false
    confirmsClosing = false
    destroyGuest()
    if (launchId && release) {
      void release(launchId).catch((error: unknown) => {
        logger.warn('releasing the launch failed:', error instanceof Error ? error.message : error)
      })
    }
  })

  createGuest(win)
  layoutGuest(win)
  showWhenReady(win, { raise: true })
}

export function getMiniAppWindow(): BrowserWindow | null {
  return miniAppWindow && !miniAppWindow.isDestroyed() ? miniAppWindow : null
}

/** What `miniapp:init` answers. Only the strip calls it. */
export function miniAppWindowState(): MiniAppState {
  if (!opened) throw new AppError('internal', '小程序窗口没有打开任何小程序')
  return { title: opened.target.title, theme: opened.theme, controls }
}

/**
 * The strip's ×: a user close, so a page that asked for a confirmation
 * (`WebApp.setClosingConfirmation`) still gets its prompt. The shell's own
 * teardown uses `closeMiniAppWindow` instead and must not ask.
 */
export function requestMiniAppClose(): void {
  getMiniAppWindow()?.close()
}

/** A native control was pressed; the guest owns the resulting navigation/action. */
export function pressMiniAppControl(target: MiniAppPressRequest['target']): void {
  if (target === 'main') {
    if (!controls.main.isVisible || !controls.main.isActive) return
    receiveInPage('main_button_pressed')
    return
  }
  if (target === 'secondary') {
    if (!controls.secondary.isVisible || !controls.secondary.isActive) return
    receiveInPage('secondary_button_pressed')
    return
  }
  if (target === 'back') {
    if (!controls.backVisible) return
    receiveInPage('back_button_pressed')
    return
  }
  if (!controls.settingsVisible) return
  receiveInPage('settings_button_pressed')
}

/** The shell's close / 退出登录 / quit take the Mini App window with them. */
export function closeMiniAppWindow(): void {
  const win = getMiniAppWindow()
  if (!win) return
  forceClosing = true
  confirmsClosing = false
  win.close()
}

/** 设置 → 外观 reaches the strip, its native background and the page's theme params. */
export function setMiniAppTheme(theme: 'light' | 'dark'): void {
  if (opened) opened.theme = theme
  repaintWindowChrome(getMiniAppWindow(), {
    background: theme === 'dark' ? '#1e1e1f' : '#fafafa',
  })
  receiveInPage('theme_changed', { theme_params: miniAppThemeParams(theme) })
}

export function reloadMiniApp(): void {
  const win = getMiniAppWindow()
  if (!win || !opened) return
  controls = defaultMiniAppControls()
  controlsSeq += 1
  miniAppSession += 1
  commitControls()
  void guest?.webContents.loadURL(opened.target.url)
}

/** The strip's ⋮: a native menu, because the guest paints above the window's DOM. */
export function showMiniAppMenu(anchor: { x: number; y: number }): void {
  const win = getMiniAppWindow()
  if (!win) return
  const menu = Menu.buildFromTemplate([
    { label: '重载页面', click: reloadMiniApp },
    ...(controls.settingsVisible
      ? [{ label: '设置', click: () => pressMiniAppControl('settings') }]
      : []),
    { type: 'separator' },
    { label: '使用条款', click: () => openExternal(TELEGRAM_TERMS) },
    { label: '隐私政策', click: () => openExternal(TELEGRAM_PRIVACY) },
    { type: 'separator' },
    {
      label: '举报',
      click: () => {
        // Capture first: `closeMiniAppWindow` may emit `closed` synchronously,
        // and that clears `deps`.
        const userId = opened?.target.botUserId
        const report = deps?.onReport
        closeMiniAppWindow()
        if (userId !== undefined) report?.(userId)
      },
    },
  ])
  menu.popup({ window: win, x: anchor.x, y: anchor.y })
}

/**
 * The guest's `TelegramWebviewProxy.postEvent` calls. The sender is checked
 * against the current guest: a page from another web contents (or the host
 * renderer) must not drive this window.
 */
ipcMain.on('miniapp:event', (event, raw: unknown) => {
  if (!guest || event.sender !== guest.webContents) return
  const payload = parseMiniAppEvent(raw)
  if (!payload) return
  void Promise.resolve(
    handleMiniAppEvent(payload.eventType, payload.eventData, bridgeHost()),
  ).catch((error: unknown) => {
    logger.warn('guest event failed:', error instanceof Error ? error.message : error)
  })
})

/** The effects the page's events reach; the window owns every one of them. */
function bridgeHost(): MiniAppBridgeHost {
  const requestGuest = guest
  const requestSession = miniAppSession
  return {
    receive: (eventType, eventData) => {
      if (guest !== requestGuest || miniAppSession !== requestSession) return
      receiveInPage(eventType, eventData)
    },
    close: () => getMiniAppWindow()?.close(),
    sendData: (data) => {
      if (!opened || !deps) return
      void deps
        .sendData({
          botUserId: opened.target.botUserId,
          buttonText: opened.target.buttonText,
          data,
        })
        .catch((error: unknown) => {
          logger.warn('WebApp.sendData failed:', error instanceof Error ? error.message : error)
        })
    },
    invokeCustomMethod: async (method, parameters) => {
      if (!opened || !deps) throw new Error('Mini App is no longer open')
      return deps.invokeCustomMethod({ botUserId: opened.target.botUserId, method, parameters })
    },
    biometryInfo: async () => {
      if (!opened || !deps) throw new Error('Mini App is no longer open')
      return deps.biometry.info(opened.target.userId, opened.target.botUserId)
    },
    biometryRequestAccess: async (reason) => {
      if (!opened || !deps) throw new Error('Mini App is no longer open')
      return deps.biometry.requestAccess(
        opened.target.userId,
        opened.target.botUserId,
        reason,
        getMiniAppWindow(),
      )
    },
    biometryAuthenticate: async (reason) => {
      if (!opened || !deps) throw new Error('Mini App is no longer open')
      return deps.biometry.authenticate(
        opened.target.userId,
        opened.target.botUserId,
        reason,
        getMiniAppWindow(),
      )
    },
    biometryUpdateToken: async (token) => {
      if (!opened || !deps) throw new Error('Mini App is no longer open')
      return deps.biometry.updateToken(opened.target.userId, opened.target.botUserId, token)
    },
    biometryOpenSettings: () => deps?.biometry.openSettings(),
    theme: () => opened?.theme ?? 'light',
    openExternal,
    requestViewport: () => {
      const win = getMiniAppWindow()
      if (win) sendViewport(win)
    },
    setClosingConfirmation: (needed) => {
      confirmsClosing = needed
    },
    showPopup,
    setupMainButton: (patch) => {
      controls = withActionBarHeight({
        ...controls,
        main: applyBottomButtonPatch(controls.main, patch),
      })
      commitControls()
    },
    setupSecondaryButton: (patch) => {
      controls = withActionBarHeight({
        ...controls,
        secondary: applyBottomButtonPatch(controls.secondary, patch),
      })
      commitControls()
    },
    setupBackButton: (patch) => {
      controls = { ...controls, backVisible: applyVisibilityPatch(controls.backVisible, patch) }
      commitControls()
    },
    setupSettingsButton: (patch) => {
      controls = {
        ...controls,
        settingsVisible: applyVisibilityPatch(controls.settingsVisible, patch),
      }
      commitControls()
    },
    setBottomBarColor: (patch) => {
      controls = {
        ...controls,
        bottomBarColor: applyBottomBarColor(patch, controls.bottomBarColor),
      }
      commitControls()
    },
    unhandled: (eventType) => logger.info(`guest event not handled: ${eventType}`),
  }
}

/** Native chrome changed: only the Mini App host renderer receives this sequence. */
function commitControls(): void {
  controlsSeq += 1
  const win = getMiniAppWindow()
  if (!win) return
  win.webContents.send('evt:miniappControls', { seq: controlsSeq, payload: controls })
  layoutGuest(win)
  sendViewport(win)
}

/** `WebApp.showPopup`: Electron's native box, answered with `popup_closed`. */
function showPopup(popup: MiniAppPopup): void {
  const win = getMiniAppWindow()
  if (!win) return
  const requestGuest = guest
  const requestSession = miniAppSession
  const cancelId = popup.buttons.findIndex(
    (button) => button.type === 'cancel' || button.type === 'close',
  )
  const defaultId = popup.buttons.findIndex((button) => button.type === 'ok')
  void dialog
    .showMessageBox(win, {
      type: 'none',
      title: popup.title || '小程序',
      message: popup.message,
      buttons: popup.buttons.map((button) => button.text),
      ...(defaultId < 0 ? {} : { defaultId }),
      ...(cancelId < 0 ? {} : { cancelId }),
    })
    .then(({ response }) => {
      if (guest !== requestGuest || miniAppSession !== requestSession) return
      const button = popup.buttons[response]
      receiveInPage('popup_closed', button === undefined ? {} : { button_id: button.id })
    })
    .catch((error: unknown) => {
      logger.warn('popup failed:', error instanceof Error ? error.message : error)
      if (guest !== requestGuest || miniAppSession !== requestSession) return
      receiveInPage('popup_closed', {})
    })
}

function createGuest(win: BrowserWindow): void {
  if (!opened) return
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/miniapp.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })
  guest = view
  view.setBackgroundColor(opened.theme === 'dark' ? '#1e1e1f' : '#ffffff')
  win.contentView.addChildView(view)

  // A Mini App is a website: a link it opens is not allowed to navigate this
  // window away from it, and a new window is never a second app window.
  view.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  view.webContents.on('will-navigate', (event, url) => {
    if (url === opened?.target.url) return
    let sameOrigin = false
    try {
      sameOrigin = opened !== null && new URL(url).origin === new URL(opened.target.url).origin
    } catch {
      // A malformed URL is refused, not navigated to.
    }
    if (sameOrigin) return
    event.preventDefault()
    openExternal(url)
  })
  view.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    // -3 is ERR_ABORTED: a navigation the page itself replaced, not a failure.
    if (!isMainFrame || code === -3) return
    // Never log the signed URL: its fragment carries the account's tgWebAppData.
    logger.warn(`guest failed to load (${code} ${description}) at ${originOf(failedUrl)}`)
    void view.webContents.loadURL(errorPage(description))
  })
  view.webContents.on('did-finish-load', () => {
    if (guest !== view) return
    sendViewport(win)
  })
  view.webContents.on('render-process-gone', (_event, details) => {
    logger.warn('guest renderer gone:', details.reason)
    if (guest !== view) return
    void view.webContents.loadURL(errorPage('小程序页面崩溃了'))
  })
  // The page's console is deliberately not forwarded: it is remote text, and a
  // page that logs `location.href` would write the signed URL into app.log.

  void view.webContents.loadURL(opened.target.url)
}

function destroyGuest(): void {
  if (!guest) return
  try {
    miniAppWindow?.contentView.removeChildView(guest)
  } catch {
    // The window may already be gone during teardown; the web contents still is.
  }
  try {
    guest.webContents.close()
  } catch (error) {
    logger.warn('closing guest failed:', error instanceof Error ? error.message : error)
  }
  guest = null
}

function layoutGuest(win: BrowserWindow): void {
  if (!guest) return
  const size = win.getContentSize()
  const width = size[0] ?? 0
  const height = size[1] ?? 0
  guest.setBounds({
    x: 0,
    y: MINI_APP_BAR_H,
    width,
    height: Math.max(0, height - MINI_APP_BAR_H - controls.actionBarHeight),
  })
}

function sendViewport(win: BrowserWindow): void {
  if (!guest) return
  const size = win.getContentSize()
  const height = size[1] ?? 0
  receiveInPage('viewport_changed', {
    height: Math.max(0, height - MINI_APP_BAR_H - controls.actionBarHeight),
    is_state_stable: true,
    is_expanded: true,
  })
}

/** Main -> page, through the door `telegram-web-app.js` documents. */
function receiveInPage(eventType: string, eventData?: unknown): void {
  const view = guest
  if (!view || view.webContents.isDestroyed()) return
  const dataArgument = eventData === undefined ? '' : `, ${jsString(eventData)}`
  const script = `window.Telegram && window.Telegram.WebView && window.Telegram.WebView.receiveEvent(${jsString(
    eventType,
  )}${dataArgument});`
  void view.webContents.executeJavaScript(script).catch((error: unknown) => {
    logger.warn(
      `could not deliver ${eventType} to the page:`,
      error instanceof Error ? error.message : error,
    )
  })
}

function openExternal(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      void shell.openExternal(url)
      return
    }
  } catch {
    // Falls through to the warning.
  }
  logger.warn(`refused to open a ${originOf(url)} link`)
}

/** Origin only: a refused URL may carry a token in its query or fragment. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'malformed'
  }
}

function jsString(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(/</g, '\\u003c')
}

/** A failed load is still a window: it says so, and ⋮ → 重载页面 retries. */
function errorPage(detail: string): string {
  const text = detail.replace(/[<>&"]/g, (character) =>
    character === '<'
      ? '&lt;'
      : character === '>'
        ? '&gt;'
        : character === '&'
          ? '&amp;'
          : '&quot;',
  )
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#fafafa;color:#191919;font-family:'Microsoft YaHei',sans-serif"><div style="text-align:center"><p style="font-size:15px;margin:0 0 8px">小程序加载失败</p><p style="font-size:12px;color:#999;margin:0">${text}</p><p style="font-size:12px;color:#999;margin:18px 0 0">点右上角 ⋮ 重载页面</p></div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
