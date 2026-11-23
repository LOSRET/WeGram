import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppInfo, AuthState, ConnectionState, ProxyConfig } from '@wegram/protocol'
import { app, BrowserWindow, dialog, nativeTheme, powerMonitor, session } from 'electron'

import { parseApiCredentials } from './credentials'
import { createHandlers } from './ipc/handlers'
import { registerIpc, unregisterIpc } from './ipc/router'
import { closeLoginWindow, createLoginWindow, getLoginWindow } from './login-window'
import { installMediaProtocol, registerMediaScheme } from './media/protocol'
import { pruneVoiceNotes } from './media/voice-file'
import { NotificationCenter } from './notifications'
import { storedProxyToConfig, toProxyView } from './proxy'
import { ProxyController } from './proxy-controller'
import { describeProxy, parseProxyUrl } from './proxy-url'
import { reachableOverTcp, readSystemProxy } from './system-proxy'
import { SettingsStore } from './store/settings'
import { getCloseBehavior, getDesktopNotifications } from './store/prefs'
import { UiDatabase } from './store/ui-db'
import { createAdapter } from './telegram'
import type { TelegramAdapter } from './telegram/adapter'
import { publishAdapterEvent } from './telegram/events'
import { EventBus } from './telegram/updates'
import { createTray, destroyTray } from './tray'
import { createLogger } from './util'
import { closeSettingsWindow, setSettingsTheme } from './settings-window'
import { closeViewer, hideViewerWithShell, setViewerTheme, showViewerWithShell } from './viewer'
import {
  applyTitleBarTheme,
  createMainWindow,
  raiseShellAboveViewer,
  resolveTheme,
  storedTheme,
  themePreference,
} from './windows'

const logger = createLogger('main')
const isDev = !app.isPackaged

// package.json name is the scoped workspace name ("@wegram/desktop"), which
// would turn userData into a nested @wegram/desktop directory. Pin it.
app.setName('WeGram')
app.setPath('userData', join(app.getPath('appData'), 'WeGram'))

// Windows groups this process's toasts under one app identity. Without it the
// Notification API has no AppUserModelID to show and silently drops the toast.
app.setAppUserModelId('dev.wegram.desktop')

// A custom scheme must be declared privileged before the app is ready, otherwise
// <img>/<video>/fetch() in the renderer cannot load downloaded media.
registerMediaScheme()

let mainWindow: BrowserWindow | null = null
let adapter: TelegramAdapter | null = null
/** Owns the proxy in force (§6.4): the mode, the OS proxy and the reachability retry. */
let proxyController: ProxyController | null = null
let bus: EventBus | null = null
let uiDb: UiDatabase | null = null
let notifications: NotificationCenter | null = null
/**
 * Set before `before-quit` stops the adapter: the stop closes the client, which
 * emits `auth: closed`, and that must not resurrect the login window mid-quit.
 */
let quitting = false
/**
 * True once this run has asked TDLib for something the user initiated (phone,
 * code, password, QR). A login that completes after that goes straight to the
 * shell, like WeChat; a session restored at startup instead stops on the profile
 * step until 进入 WeGram. See `syncWindowsToAuth`.
 */
let authInteracted = false

loadDotEnv()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Whichever window the app currently lives in: the shell once the login
    // window handed over, the login window before that.
    const win = mainWindow ?? getLoginWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(bootstrap)
}

async function bootstrap(): Promise<void> {
  const userDataDir = app.getPath('userData')

  installMediaProtocol({ adapter: () => adapter })

  const store = new SettingsStore(join(userDataDir, 'settings.json'))
  store.load()

  const db = new UiDatabase(join(userDataDir, 'ui.db'))
  db.open()
  uiDb = db

  // 跟随系统: while the preference is 'system' the OS is the only thing that can
  // tell us the theme changed, and every window (plus the shell renderer through
  // evt:theme) has to follow it.
  nativeTheme.on('updated', () => {
    if (themePreference(db) === 'system') applyTheme(resolveTheme('system'))
  })

  // A viewer opened before the first theme change must still get a dark strip,
  // so seed the module with the stored theme instead of defaulting to light.
  setViewerTheme(storedTheme(db))

  // Recordings nobody can still be uploading are dead weight (see voice-file.ts).
  void pruneVoiceNotes(join(userDataDir, 'voice')).then((removed) => {
    if (removed > 0) logger.info(`pruned ${removed} old voice recording(s)`)
  })

  /**
   * The microphone is granted to the shell only.
   *
   * 语音消息 needs `getUserMedia` in the renderer, and Electron's default with no
   * handler is "allow everything" — which would also let the login, 群二维码 and
   * viewer windows open a device. Every other permission keeps that default (the
   * contact card's clipboard write is one); only `media` is narrowed, and only to
   * the window that actually owns the composer.
   */
  const isShell = (contents: Electron.WebContents | null): boolean =>
    mainWindow !== null && !mainWindow.isDestroyed() && contents === mainWindow.webContents
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    if (permission !== 'media') {
      callback(true)
      return
    }
    if (!isShell(contents)) logger.warn('refused microphone access outside the shell window')
    callback(isShell(contents))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    permission === 'media' ? isShell(contents) : true,
  )

  // Credentials come from the environment (.env in development) and, for a release
  // artifact, from the value the build inlined (electron.vite.config.ts).
  const builtIn = parseApiCredentials(__WEGRAM_API_CREDENTIALS__)
  const apiId = Number(process.env.TELEGRAM_API_ID ?? 0) || builtIn?.apiId || 0
  const apiHash = (process.env.TELEGRAM_API_HASH ?? '').trim() || builtIn?.apiHash || ''

  // A packaged build must never present the fake data set: without credentials it is
  // a broken artifact (CI checks its secrets before packaging), and fixtures that look
  // like a working Telegram are worse than refusing to start.
  if ((apiId <= 0 || !apiHash) && !isDev) {
    dialog.showErrorBox(
      'WeGram 无法连接 Telegram',
      '这个安装包没有内置 TELEGRAM_API_ID / TELEGRAM_API_HASH。\n请用仓库 secrets 重新打包（见 .github/workflows/release.yml）。',
    )
    app.quit()
    return
  }

  // The proxy in force is decided in one place (main/proxy-controller.ts, §6.4):
  // an explicit manual configuration, then WEGRAM_PROXY, then the operating
  // system's proxy, then a direct connection. TDLib has to be created *with* its
  // proxy, so the first resolution happens before the adapter exists.
  let envProxy: ProxyConfig | null = null
  try {
    envProxy = parseProxyUrl(process.env['WEGRAM_PROXY'])
    if (envProxy) logger.info(`WEGRAM_PROXY overrides the system proxy: ${describeProxy(envProxy)}`)
  } catch (error) {
    logger.warn(
      'ignoring invalid WEGRAM_PROXY:',
      error instanceof Error ? error.message : String(error),
    )
  }

  const controller = new ProxyController({
    mode: () => store.get().proxyMode,
    manualConfig: () => storedProxyToConfig(store.get().proxy),
    manualView: () => toProxyView(store.get().proxy),
    envProxy,
    readSystemProxy: () => readSystemProxy(logger),
    reachable: reachableOverTcp,
    logger,
    // The system proxy can change while the app runs (the reader's proxy client is
    // closed or reopened); every open 网络与代理 panel repaints from here.
    onChange: (state) => bus?.publish('evt:proxy', state),
  })
  proxyController = controller

  // No apply: the adapter below is created with this answer.
  const initialProxy = (await controller.resolve({ apply: false })).active

  const createdAdapter = createAdapter({
    ...(apiId > 0 ? { apiId } : {}),
    ...(apiHash ? { apiHash } : {}),
    userDataDir,
    initialProxy,
    initialPreferIpv6: store.get().preferIpv6,
    allowMock: isDev,
    applicationVersion: app.getVersion(),
  })
  adapter = createdAdapter
  controller.attach({
    applyProxy: (config) => createdAdapter.setProxy(config),
    testProxy: (config) => createdAdapter.testProxy(config),
  })
  controller.markApplied(initialProxy)
  controller.start()
  // Waking up is the one moment the OS proxy commonly changed while we slept.
  powerMonitor.on('resume', () => {
    void controller.refresh()
  })

  bus = new EventBus({
    send: (channel, envelope) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, envelope)
      }
    },
  })
  /**
   * Raise the shell and hand it a chat + message. Used by the viewer's 定位 and by
   * a notification click: both mean "show me this conversation, now".
   */
  const openChatAt = ({
    chatId,
    messageId,
    topicId,
  }: {
    chatId: number
    messageId: number
    /** 话题 (design doc §9.12): a forum hit opens its topic first. */
    topicId?: number
  }): void => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    raiseShellAboveViewer(win)
    bus?.publish('evt:locate', {
      chatId,
      messageId,
      ...(topicId === undefined ? {} : { topicId }),
    })
  }

  notifications = new NotificationCenter({
    getShellWindow: () => mainWindow,
    onOpen: openChatAt,
    // 设置 → 消息通知's master switch, read per delivery (it is local, ui.db state).
    enabled: () => getDesktopNotifications(db),
  })

  /** The shell seeds its header from this once (`network:connection`, §7.1). */
  let lastConnection: ConnectionState = 'connecting'

  adapter.onEvent((event) => {
    // Windows follow authorization, not the renderer: the shell may only exist
    // while an account is signed in (see syncWindowsToAuth).
    if (event.type === 'auth') syncWindowsToAuth(event.state)
    if (event.type === 'connection') lastConnection = event.state
    // A desktop notification is an OS concern: it never crosses IPC.
    if (event.type === 'notification') {
      notifications?.notify(event)
      return
    }
    if (bus) publishAdapterEvent(bus, event)
  })

  const info: AppInfo = {
    version: app.getVersion(),
    appVersion: app.getVersion(),
    adapter: adapter.kind,
    userDataPath: userDataDir,
  }

  registerIpc(
    createHandlers({
      adapter,
      store,
      uiDb: db,
      info,
      proxyController: controller,
      connection: () => lastConnection,
      // Every window repaints from here: the shell's native strip, the viewer, the
      // settings window and the shell renderer (via evt:theme). Missing one is how
      // "I switched to dark and this window stayed light" happens (design doc §9.11.4).
      onThemeChange: applyTheme,
      /**
       * 发送消息 or 消息字号 changed in the settings window: the shell reads both
       * from its store, so they are delivered like any other state change.
       */
      onSettingsChange: (settings) => bus?.publish('evt:settings', settings),
      // The login window's 进入 button: the shell takes over, the login window goes.
      onLoginEnter: () => showMainWindow(storedTheme(db), 'after-ready'),
      onAuthInteraction: () => {
        authInteracted = true
      },
      /**
       * 定位到聊天位置: the viewer stays open, the shell comes forward above it and
       * the renderer opens the conversation on that message.
       */
      onLocate: openChatAt,
      /**
       * Which conversation the shell is showing, so a toast for that chat can be
       * suppressed while the window is focused (see NotificationCenter).
       */
      setActiveChat: (chatId) => notifications?.setActiveChat(chatId),
    }),
  )

  // The app starts in the login window, like WeChat: an existing TDLib session
  // lands on the profile step, a fresh one on the phone form. The shell window is
  // only created once the reader clicks 进入 WeGram.
  openLoginWindow()

  // The notification-area icon: a shortcut back to a minimized window, and a way
  // out without hunting for the shell.
  createTray({
    onOpen: () => {
      const win = mainWindow ?? getLoginWindow()
      if (!win || win.isDestroyed()) {
        openLoginWindow()
        return
      }
      raiseShellAboveViewer(win)
      showViewerWithShell()
    },
  })

  try {
    await adapter.start()
    logger.info(`adapter started: ${adapter.kind}`)
  } catch (error) {
    logger.error('adapter failed to start:', error instanceof Error ? error.message : error)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openLoginWindow()
  })
}

/**
 * Applies one resolved theme everywhere it is visible. The renderer half arrives
 * through `evt:theme`; the three native windows have to be repainted here.
 */
function applyTheme(theme: 'light' | 'dark'): void {
  applyTitleBarTheme(mainWindow, theme)
  setViewerTheme(theme)
  setSettingsTheme(theme)
  bus?.publish('evt:theme', { theme })
}

/** Opens (or re-focuses) the standalone login window. */
function openLoginWindow(): void {
  const existing = getLoginWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return
  }
  createLoginWindow(storedTheme(uiDb))
}

/**
 * Opens (or re-focuses) the shell window and dismisses the login window.
 *
 * The shell is created first and the login window is closed from its
 * `ready-to-show` handler: closing the last window would trip
 * `window-all-closed` and quit the app mid-hand-over.
 */
function showMainWindow(theme: 'light' | 'dark', closeLogin: 'immediate' | 'after-ready'): void {
  const existing = mainWindow
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    closeLoginWindow()
    return
  }

  const win = createMainWindow(theme)
  mainWindow = win
  // A notification flashed the task bar; the flash stops as soon as the reader
  // comes back, however they did it.
  win.on('focus', () => {
    if (!win.isDestroyed()) win.flashFrame(false)
  })
  /**
   * 关闭主窗口 follows 通用's preference: hide into the tray, or quit as before.
   * Hiding is not closing, so the windows that a quit would take down must be dealt
   * with here — otherwise the reader gets a settings sheet floating over nothing.
   */
  win.on('close', (event) => {
    if (quitting) return
    if (getCloseBehavior(uiDb) === 'tray') {
      event.preventDefault()
      closeSettingsWindow()
      hideViewerWithShell()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    // The viewer and the settings window are separate top-level windows: they do not
    // die with this one, and `window-all-closed` would never fire if they lingered.
    closeViewer()
    closeSettingsWindow()
  })
  if (closeLogin === 'immediate') {
    // First sign-in: the login window must not linger on the profile step. The
    // shell already exists (hidden), so `window-all-closed` cannot fire here.
    closeLoginWindow()
  } else {
    win.once('ready-to-show', () => closeLoginWindow())
  }
}

/**
 * Authorization can leave `ready` without the renderer asking: TDLib may close
 * the client, and 退出登录 is an invoke whose auth event arrives after the
 * request. The shell cannot stay open without an account, so swap back to the
 * login window — created first, or `window-all-closed` would quit the app in
 * the gap.
 */
function syncWindowsToAuth(state: AuthState): void {
  if (quitting) return
  if (state.kind === 'ready') {
    /**
     * WeChat's rule: the sign-in itself ends in the main window, while a session
     * restored at startup stops on the profile step (`login:enter` opens the
     * shell). `authInteracted` is what tells the two apart.
     */
    if (authInteracted) showMainWindow(storedTheme(uiDb), 'immediate')
    return
  }
  if (!mainWindow) return
  openLoginWindow()
  mainWindow.close()
}

/**
 * Minimal .env support for development: credentials must never be hard-coded
 * and must come from the user's own my.telegram.org application (design doc §10).
 */
function loadDotEnv(): void {
  const candidates = [join(process.cwd(), '.env'), join(app.getAppPath(), '.env')]
  for (const file of candidates) {
    try {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
        if (!match?.[1]) continue
        if (process.env[match[1]]) continue
        process.env[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '')
      }
    } catch {
      // No .env is a valid state: the mock adapter runs instead.
    }
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // The adapter stop below emits `auth: closed`; that is a teardown, not a logout.
  quitting = true
  closeSettingsWindow()
  bus?.dispose()
  bus = null
  unregisterIpc()
  notifications?.dispose()
  notifications = null
  destroyTray()
  proxyController?.stop()
  proxyController = null
  void adapter?.stop()
  adapter = null
  uiDb?.close()
  uiDb = null
})
