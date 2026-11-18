import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppInfo, AuthState } from '@wegram/protocol'
import { app, BrowserWindow, dialog, shell } from 'electron'

import { parseApiCredentials } from './credentials'
import { createHandlers } from './ipc/handlers'
import { registerIpc, unregisterIpc } from './ipc/router'
import { closeLoginWindow, createLoginWindow, getLoginWindow } from './login-window'
import { installMediaProtocol, registerMediaScheme } from './media/protocol'
import { storedProxyToConfig } from './proxy'
import { parseProxyUrl } from './proxy-url'
import { SettingsStore } from './store/settings'
import { UiDatabase } from './store/ui-db'
import { createAdapter } from './telegram'
import type { TelegramAdapter } from './telegram/adapter'
import { publishAdapterEvent } from './telegram/events'
import { EventBus } from './telegram/updates'
import { createLogger } from './util'
import {
  closeViewer,
  hideViewerWithShell,
  setViewerTheme,
  showViewerWithShell,
} from './viewer'

const logger = createLogger('main')
const isDev = !app.isPackaged

// package.json name is the scoped workspace name ("@wegram/desktop"), which
// would turn userData into a nested @wegram/desktop directory. Pin it.
app.setName('WeGram')
app.setPath('userData', join(app.getPath('appData'), 'WeGram'))

// A custom scheme must be declared privileged before the app is ready, otherwise
// <img>/<video>/fetch() in the renderer cannot load downloaded media.
registerMediaScheme()

let mainWindow: BrowserWindow | null = null
let adapter: TelegramAdapter | null = null
let bus: EventBus | null = null
let uiDb: UiDatabase | null = null
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

  installMediaProtocol()

  const store = new SettingsStore(join(userDataDir, 'settings.json'))
  store.load()

  const db = new UiDatabase(join(userDataDir, 'ui.db'))
  db.open()
  uiDb = db

  // A viewer opened before the first theme change must still get a dark strip,
  // so seed the module with the stored theme instead of defaulting to light.
  setViewerTheme(storedTheme(db))

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

  // Stored settings win; the env var is a dev convenience so a fresh profile can
  // reach Telegram without clicking through the proxy dialog first.
  let initialProxy = storedProxyToConfig(store.get().proxy)
  if (!initialProxy) {
    try {
      initialProxy = parseProxyUrl(process.env['WEGRAM_PROXY'])
      if (initialProxy)
        logger.info(
          `using WEGRAM_PROXY (${initialProxy.type} ${initialProxy.host}:${initialProxy.port})`,
        )
    } catch (error) {
      logger.warn(
        'ignoring invalid WEGRAM_PROXY:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  adapter = createAdapter({
    ...(apiId > 0 ? { apiId } : {}),
    ...(apiHash ? { apiHash } : {}),
    userDataDir,
    initialProxy,
    allowMock: isDev,
  })

  bus = new EventBus({
    send: (channel, envelope) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, envelope)
      }
    },
  })
  adapter.onEvent((event) => {
    // Windows follow authorization, not the renderer: the shell may only exist
    // while an account is signed in (see syncWindowsToAuth).
    if (event.type === 'auth') syncWindowsToAuth(event.state)
    if (bus) publishAdapterEvent(bus, event)
  })

  const info: AppInfo = {
    version: '0.1.0',
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
      onThemeChange: (theme) => {
        applyTitleBarTheme(mainWindow, theme)
        setViewerTheme(theme)
      },
      // The login window's 进入 button: the shell takes over, the login window goes.
      onLoginEnter: () => showMainWindow(storedTheme(db), 'after-ready'),
      onAuthInteraction: () => {
        authInteracted = true
      },
      /**
       * 定位到聊天位置: the viewer stays open, the shell comes forward above it and
       * the renderer opens the conversation on that message.
       */
      onLocate: ({ chatId, messageId }) => {
        const win = mainWindow
        if (!win || win.isDestroyed()) return
        raiseShellAboveViewer(win)
        bus?.publish('evt:locate', { chatId, messageId })
      },
    }),
  )

  // The app starts in the login window, like WeChat: an existing TDLib session
  // lands on the profile step, a fresh one on the phone form. The shell window is
  // only created once the reader clicks 进入 WeGram.
  openLoginWindow()

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
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    // The viewer is a separate top-level window, so it does not die with this one:
    // close it explicitly, or signing out would leave a picture window floating and
    // `window-all-closed` would never fire.
    closeViewer()
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
 * Brings the shell window forward above the standalone viewer.
 *
 * Both are plain top-level windows, so `moveTop()` is what puts the chat on top of
 * the still-open picture (design: the viewer is not owned by the shell, which is
 * what keeps the task bar looking like WeChat's — one WeGram button with both
 * windows in its hover preview).
 */
function raiseShellAboveViewer(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.moveTop()
  win.focus()
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

function createMainWindow(theme: 'light' | 'dark'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: theme === 'dark' ? '#1e1e1f' : '#fbfbfb',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // Must match --wx-rail / --wx-rail-icon, or the strip reads as a seam.
      color: theme === 'dark' ? '#2d2d2e' : '#e0e0e0',
      symbolColor: theme === 'dark' ? '#969697' : '#191919',
      height: 32,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => {
    applyTitleBarTheme(win, theme)
    win.show()
  })

  // The viewer is not owned by this window any more, so its "put the picture away
  // with the chat" behaviour is explicit here (see main/viewer.ts).
  win.on('minimize', hideViewerWithShell)
  win.on('restore', showViewerWithShell)

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl && url.startsWith(rendererUrl)) return
    event.preventDefault()
    openExternal(url)
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** Only https and tg: links leave the app (design doc §8.3). */
function openExternal(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'tg:') {
      void shell.openExternal(url)
    }
  } catch {
    logger.warn('refused to open malformed URL')
  }
}

function storedTheme(uiDb: UiDatabase | null): 'light' | 'dark' {
  return uiDb?.getSetting('theme') === 'dark' ? 'dark' : 'light'
}

/**
 * titleBarOverlay is drawn by Windows, not by CSS, so it must be repainted when
 * the theme changes — otherwise a dark UI keeps a light window-controls strip.
 */
function applyTitleBarTheme(win: BrowserWindow | null, theme: 'light' | 'dark'): void {
  if (!win || win.isDestroyed()) return
  try {
    win.setTitleBarOverlay({
      color: theme === 'dark' ? '#2d2d2e' : '#e0e0e0',
      symbolColor: theme === 'dark' ? '#969697' : '#191919',
      height: 32,
    })
  } catch (error) {
    logger.warn(
      'setTitleBarOverlay failed:',
      error instanceof Error ? error.message : String(error),
    )
  }
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
  bus?.dispose()
  bus = null
  unregisterIpc()
  void adapter?.stop()
  adapter = null
  uiDb?.close()
  uiDb = null
})
