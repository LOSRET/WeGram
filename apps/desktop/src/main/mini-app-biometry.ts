import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { dialog, safeStorage, shell, type BrowserWindow } from 'electron'

import type { UiDatabase } from './store/ui-db'
import { createLogger } from './util'
import type { BiometryWorkerRequest, BiometryWorkerResponse } from './biometry-worker-protocol'

const logger = createLogger('miniapp-biometry')
const DEVICE_ID_KEY = 'miniapp_device_id'
const DPAPI_PREFIX = 'dpapi:'
const WORKER_TIMEOUT_MS = 120_000

export interface MiniAppBiometryInfo {
  available: boolean
  type: 'finger' | 'face' | 'unknown'
  accessRequested: boolean
  accessGranted: boolean
  tokenSaved: boolean
  deviceId: string
}

export interface MiniAppBiometryService {
  info(userId: number, botUserId: number): Promise<MiniAppBiometryInfo>
  requestAccess(
    userId: number,
    botUserId: number,
    reason: string | undefined,
    win: BrowserWindow | null,
  ): Promise<MiniAppBiometryInfo>
  authenticate(
    userId: number,
    botUserId: number,
    reason: string | undefined,
    win: BrowserWindow | null,
  ): Promise<{ status: 'authorized' | 'failed'; token?: string }>
  updateToken(
    userId: number,
    botUserId: number,
    token: string,
  ): Promise<{ status: 'updated' | 'removed' | 'failed' }>
  openSettings(): void
}

/** Windows Hello runs in a worker thread because `win-hello` is synchronous. */
export function createMiniAppBiometry(db: UiDatabase): MiniAppBiometryService {
  let availability: Promise<boolean> | null = null
  let verifying = false
  let requestSequence = 0

  const available = (): Promise<boolean> => {
    if (process.platform !== 'win32') return Promise.resolve(false)
    availability ??= runWorker({ id: nextRequestId(), kind: 'availability' })
      .then((response) => response.available === true)
      .catch(() => false)
    return availability
  }

  const info = async (userId: number, botUserId: number): Promise<MiniAppBiometryInfo> => {
    const isAvailable = await available()
    const record = db.getMiniAppBiometry(userId, botUserId)
    const token = isAvailable ? unsealToken(record.tokenSealed) : null
    return {
      available: isAvailable,
      type: 'unknown',
      accessRequested: isAvailable && record.accessRequested,
      accessGranted: isAvailable && record.accessGranted,
      tokenSaved: token !== null,
      deviceId: deviceId(db),
    }
  }

  return {
    info,
    requestAccess: async (userId, botUserId, reason, win) => {
      const isAvailable = await available()
      if (!isAvailable) {
        db.setMiniAppBiometryAccess(userId, botUserId, { requested: true, granted: false })
        return info(userId, botUserId)
      }
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        title: 'Windows Hello',
        message: '允许这个小程序使用 Windows Hello 验证你的身份吗？',
        detail: reason?.trim() || '小程序会在需要时请求系统验证。',
        buttons: ['允许', '取消'],
        defaultId: 1,
        cancelId: 1,
      }
      const answer = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options)
      const granted = answer.response === 0
      db.setMiniAppBiometryAccess(userId, botUserId, { requested: true, granted })
      return info(userId, botUserId)
    },
    authenticate: async (userId, botUserId, reason, win) => {
      const record = db.getMiniAppBiometry(userId, botUserId)
      if (!record.accessGranted || !(await available()) || verifying || !win) {
        return { status: 'failed' }
      }
      verifying = true
      try {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        const response = await runWorker({
          id: nextRequestId(),
          kind: 'verify',
          message: reason?.trim().slice(0, 128) || 'Verify your identity',
          windowHandle: Array.from(win.getNativeWindowHandle()),
        })
        if (response.verified !== true) {
          logger.warn('Windows Hello verification failed:', response.error ?? 'not verified')
          return { status: 'failed' }
        }
        return { status: 'authorized', token: unsealToken(record.tokenSealed) ?? '' }
      } catch (error) {
        logger.warn(
          'Windows Hello verification error:',
          error instanceof Error ? error.message : error,
        )
        return { status: 'failed' }
      } finally {
        verifying = false
      }
    },
    updateToken: async (userId, botUserId, token) => {
      if (token.length > 1024) return { status: 'failed' }
      if (token.length === 0) {
        db.setMiniAppBiometryToken(userId, botUserId, null)
        return { status: 'removed' }
      }
      const record = db.getMiniAppBiometry(userId, botUserId)
      if (!record.accessGranted || !(await available()) || !safeStorage.isEncryptionAvailable()) {
        return { status: 'failed' }
      }
      const sealed = sealToken(token)
      if (sealed === null) return { status: 'failed' }
      db.setMiniAppBiometryToken(userId, botUserId, sealed)
      return { status: 'updated' }
    },
    openSettings: () => {
      if (process.platform !== 'win32') return
      void shell.openExternal('ms-settings:signinoptions').catch((error: unknown) => {
        logger.warn(
          'opening Windows Hello settings failed:',
          error instanceof Error ? error.message : error,
        )
      })
    },
  }

  function nextRequestId(): number {
    requestSequence += 1
    return requestSequence
  }
}

function deviceId(db: UiDatabase): string {
  const existing = db.getSetting(DEVICE_ID_KEY)
  if (existing) return existing
  const created = randomUUID()
  db.setSetting(DEVICE_ID_KEY, created)
  return created
}

function sealToken(token: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  return DPAPI_PREFIX + safeStorage.encryptString(token).toString('base64')
}

function unsealToken(sealed: string | null): string | null {
  if (!sealed?.startsWith(DPAPI_PREFIX) || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(sealed.slice(DPAPI_PREFIX.length), 'base64'))
  } catch {
    return null
  }
}

function runWorker(request: BiometryWorkerRequest): Promise<BiometryWorkerResponse> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ id: request.id, available: false, verified: false })
  }
  let worker: Worker
  try {
    worker = new Worker(join(__dirname, 'biometry-worker.js'))
  } catch (error) {
    return Promise.reject(error)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result: BiometryWorkerResponse | Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const timer = setTimeout(() => finish(new Error('Windows Hello timed out')), WORKER_TIMEOUT_MS)
    worker.once('error', (error) => finish(error))
    worker.once('exit', () => finish(new Error('Windows Hello worker exited')))
    worker.on('message', (raw: unknown) => {
      if (!isWorkerResponse(raw) || raw.id !== request.id) return
      finish(raw)
    })
    worker.postMessage(request)
  })
}

function isWorkerResponse(value: unknown): value is BiometryWorkerResponse {
  if (typeof value !== 'object' || value === null || !('id' in value)) return false
  return typeof value.id === 'number'
}
