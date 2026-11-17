import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppInfo } from '@wegram/protocol'
import { app, BrowserWindow, shell } from 'electron'

import { createHandlers } from './ipc/handlers'
import { registerIpc, unregisterIpc } from './ipc/router'
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
import { setViewerTheme } from './viewer'

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

loadDotEnv()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(bootstrap)
}

async function bootstrap(): Promise<void> {
  const userDataDir = app.getPath('userData')

  installMediaProtocol()

  const store = new SettingsStore(join(userDataDir, 'settings.json'))
  store.load()

  uiDb = new UiDatabase(join(userDataDir, 'ui.db'))
  uiDb.open()

  // A viewer opened before the first theme change must still get a dark strip,
  // so seed the module with the stored theme instead of defaulting to light.
  setViewerTheme(storedTheme(uiDb))

  const apiId = Number(process.env.TELEGRAM_API_ID ?? 0)
  const apiHash = (process.env.TELEGRAM_API_HASH ?? '').trim()

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
  })

  bus = new EventBus({
    send: (channel, envelope) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, envelope)
      }
    },
  })
  adapter.onEvent((event) => {
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
      uiDb,
      info,
      onThemeChange: (theme) => {
        applyTitleBarTheme(mainWindow, theme)
        setViewerTheme(theme)
      },
    }),
  )

  mainWindow = createWindow(storedTheme(uiDb))

  try {
    await adapter.start()
    logger.info(`adapter started: ${adapter.kind}`)
  } catch (error) {
    logger.error('adapter failed to start:', error instanceof Error ? error.message : error)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(storedTheme(uiDb))
  })
}

function createWindow(theme: 'light' | 'dark'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: theme === 'dark' ? '#111111' : '#fbfbfb',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: theme === 'dark' ? '#191919' : '#e0e0e0',
      symbolColor: theme === 'dark' ? '#d6d6d6' : '#191919',
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
      color: theme === 'dark' ? '#191919' : '#e0e0e0',
      symbolColor: theme === 'dark' ? '#d6d6d6' : '#191919',
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
  bus?.dispose()
  bus = null
  unregisterIpc()
  void adapter?.stop()
  adapter = null
  uiDb?.close()
  uiDb = null
})
