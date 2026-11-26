import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  MiniAppMenu,
  MiniAppMenuAction,
  MiniAppMenuAnchor,
  MiniAppMenuItem,
  MiniAppPressRequest,
  MiniAppState,
} from '@wegram/protocol'
import { AppError } from '@wegram/protocol'
import { app, BrowserWindow, dialog, ipcMain, shell, WebContentsView } from 'electron'

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
import { openReportWindow } from './report-window'
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
}

interface OpenTarget {
  target: MiniAppWindowTarget
  theme: 'light' | 'dark'
}

let miniAppWindow: BrowserWindow | null = null
/** The guest web view; a re-target replaces it (a browser tab, not a new window). */
let guest: WebContentsView | null = null
/** The ⋯ card's own transparent view, layered above the guest while it is open. */
let menu: WebContentsView | null = null
let menuState: MiniAppMenu | null = null
/** Directed evt:miniappMenu sequence; the card page is its only listener. */
let menuSeq = 0
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
  // A new app invalidates a card that was open for the previous one.
  closeMiniAppMenu()
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
    // The card hangs from the ⋯'s old position; a resized window means it is stale.
    closeMiniAppMenu()
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
    destroyMenuLayer()
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
  // The card is painted from the theme it was opened with; ask again.
  closeMiniAppMenu()
  repaintWindowChrome(getMiniAppWindow(), {
    background: theme === 'dark' ? '#1e1e1f' : '#fafafa',
  })
  receiveInPage('theme_changed', { theme_params: miniAppThemeParams(theme) })
}

export function reloadMiniApp(): void {
  const win = getMiniAppWindow()
  if (!win || !opened) return
  closeMiniAppMenu()
  controls = defaultMiniAppControls()
  controlsSeq += 1
  miniAppSession += 1
  commitControls()
  void guest?.webContents.loadURL(opened.target.url)
}

/**
 * The strip's ⋮: the client's own WeChat-style card (design doc §9.4.1).
 *
 * It cannot be a native `Menu` — an OS menu brings the OS font, the OS hover
 * colour and the OS hairline, which is why it read as somebody else's — and it
 * cannot live in the strip's page either: the guest `WebContentsView` paints
 * above the window's DOM. It is therefore a second, transparent
 * `WebContentsView` layered over the guest (the `#miniappmenu` route), which
 * draws only the card. Main owns the rows and what each one does; the card is
 * handed `anchor` — the ⋯'s rectangle — so it can hang right-aligned under it.
 */
export function showMiniAppMenu(anchor: MiniAppMenuAnchor): void {
  const win = getMiniAppWindow()
  if (!win || !opened) return
  menuState = { theme: opened.theme, anchor, items: menuRows() }
  if (!menu || menu.webContents.isDestroyed()) {
    createMenuLayer(win)
    return
  }
  layoutMenu(win)
  // One layer for the whole window: spinning a renderer up per press cost ~250 ms
  // and reloading it cost another ~110 ms (both measured), so the loaded page is
  // simply told the new rows — revealing the page's own layer is one frame.
  revealMenu(menu)
}

/** Shows the card and hands its page the rows it must draw. */
function revealMenu(view: WebContentsView): void {
  if (!menuState || view.webContents.isDestroyed()) return
  menuSeq += 1
  view.webContents.send('evt:miniappMenu', { seq: menuSeq, payload: menuState })
  view.setVisible(true)
  // The card is a layer of its own, so it has to be given the keyboard: Esc is
  // the way out a reader expects, and the strip's page cannot see the keys.
  view.webContents.focus()
}

/**
 * The card's layer, created once per window and kept hidden between presses.
 *
 * A fresh `WebContentsView` starts on `about:blank`, which is WHITE, and this view
 * covers the whole window: joining the window before its own page is up flashed a
 * white sheet on every ⋯ press (reported 2026-11-27). It therefore joins hidden
 * and is revealed only after `did-finish-load`, when the transparent `#miniappmenu`
 * page is what will paint.
 */
function createMenuLayer(win: BrowserWindow): void {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  // AARRGGBB: the card is the only thing this view may paint.
  view.setBackgroundColor('#00000000')
  view.setVisible(false)
  menu = view
  win.contentView.addChildView(view)
  layoutMenu(win)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const url =
    !app.isPackaged && devUrl
      ? `${devUrl}#miniappmenu`
      : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#miniappmenu`
  void view.webContents.loadURL(url)

  view.webContents.on('did-finish-load', () => {
    // A press that already ended (Esc, a row, the window moving) must not reveal it.
    if (menu !== view) return
    revealMenu(view)
  })
  // A hidden layer that never loads would leave the menu "open" and invisible.
  view.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3 || menu !== view) return
    closeMiniAppMenu()
  })
}

/** What `miniapp:menuState` answers: the rows, the theme and the anchor. */
export function miniAppMenuState(): MiniAppMenu {
  if (!menuState) throw new AppError('internal', '小程序的 ⋯ 菜单没有打开')
  return menuState
}

/** A row was picked; `null` is the card being dismissed. */
export function pickMiniAppMenu(id: MiniAppMenuAction | null): void {
  closeMiniAppMenu()
  if (id) runMiniAppMenuAction(id)
}

/** Hides the card; safe when none is open. The layer itself is kept for the next press. */
export function closeMiniAppMenu(): void {
  menuState = null
  if (menu && !menu.webContents.isDestroyed()) menu.setVisible(false)
  // The card had the keyboard; the page it was opened over takes it back, so a
  // Mini App's own shortcuts keep working after Esc.
  if (guest && !guest.webContents.isDestroyed()) guest.webContents.focus()
}

/** The window is going away: the layer goes with it. */
function destroyMenuLayer(): void {
  const view = menu
  menu = null
  menuState = null
  if (!view) return
  try {
    miniAppWindow?.contentView.removeChildView(view)
  } catch {
    // The window may already be gone during teardown; the web contents still is.
  }
  try {
    view.webContents.close()
  } catch (error) {
    logger.warn('closing the ⋯ card failed:', error instanceof Error ? error.message : error)
  }
}

function layoutMenu(win: BrowserWindow): void {
  if (!menu) return
  const size = win.getContentSize()
  menu.setBounds({ x: 0, y: 0, width: size[0] ?? 0, height: size[1] ?? 0 })
}

/** The rows, grouped the way the official client groups them. */
function menuRows(): MiniAppMenuItem[] {
  return [
    { id: 'reload', label: '重载页面', dividerBefore: false },
    ...(controls.settingsVisible
      ? [{ id: 'settings' as const, label: '设置', dividerBefore: false }]
      : []),
    { id: 'terms', label: '使用条款', dividerBefore: true },
    { id: 'privacy', label: '隐私政策', dividerBefore: false },
    { id: 'report', label: '举报', dividerBefore: true },
  ]
}

/** The side effect behind a row. */
function runMiniAppMenuAction(id: MiniAppMenuAction): void {
  if (id === 'reload') {
    reloadMiniApp()
    return
  }
  if (id === 'settings') {
    pressMiniAppControl('settings')
    return
  }
  if (id === 'terms' || id === 'privacy') {
    openExternal(id === 'terms' ? TELEGRAM_TERMS : TELEGRAM_PRIVACY)
    return
  }
  // 举报 is its own window (design doc §9.4.1), parented to this one: the app stays
  // open (its page state survives a cancelled report) and the sheet appears above
  // it rather than behind it.
  const win = getMiniAppWindow()
  const userId = opened?.target.botUserId
  if (userId !== undefined) openReportWindow({ kind: 'user', userId }, opened?.theme ?? 'light', win)
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
  // 设置 is one of the card's rows, so a control change rebuilds it.
  closeMiniAppMenu()
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
