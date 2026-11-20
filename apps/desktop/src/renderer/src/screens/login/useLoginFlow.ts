import type { AppInfo, AuthState } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import { stepOf, type LoginStep } from '../loginModel'

/** Which method the window shows while TDLib is still waiting for a phone. */
export type LoginMode = 'qr' | 'phone'

export interface LoginFlow {
  auth: AuthState | null
  info: AppInfo | null
  mode: LoginMode
  value: string
  setValue: (next: string) => void
  busy: boolean
  error: string | null
  setError: (next: string | null) => void
  step: LoginStep
  ready: boolean
  booting: boolean
  closed: boolean
  isMock: boolean
  qrLink: string | null
  qrPending: boolean
  phoneEntry: boolean
  /** QR request has been waiting long enough to be worth a proxy hint. */
  slowQr: boolean
  inputRef: RefObject<HTMLInputElement | null>
  submit: () => Promise<void>
  enter: () => Promise<void>
  switchAccount: () => Promise<void>
  switchToPhone: () => Promise<void>
  showQr: () => void
  retryQr: () => void
  close: () => void
}

/**
 * The login window's whole sign-in flow (design doc §9.6): follow `evt:auth`,
 * ask TDLib for a QR when it waits for a phone, run the phone/code/password
 * steps, and switch methods.
 *
 * QR is the primary method, like WeChat. TDLib hands us a short-lived
 * `tg://login?token=…` link and re-issues it every few seconds, so the window
 * simply follows `evt:auth` / `waitQr`. The phone form is the fallback —
 * TDLib cannot leave a pending QR confirmation, so `auth:reset` rebuilds the
 * auth client for that switch.
 *
 * Renderer half of `main/login-window.ts`. The window owns no chat state: it
 * only follows auth events, so the two windows never both hydrate the chat store.
 */
export function useLoginFlow(): LoginFlow {
  /** `null` until `auth:state` answers: the form must not flash before we know. */
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [mode, setMode] = useState<LoginMode>('qr')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slowQr, setSlowQr] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** An `evt:auth` that arrived before `auth:state` answered is the newer truth. */
  const sawAuthEvent = useRef(false)
  /** One QR request per `waitPhoneNumber` episode; TDLib must not be spammed. */
  const qrRequested = useRef(false)
  /** The user switched to the phone form, so a late QR rejection is irrelevant. */
  const qrAbandoned = useRef(false)

  useEffect(() => {
    let alive = true
    const unsubscribe = window.tg.on('evt:auth', (event) => {
      sawAuthEvent.current = true
      setAuth(event.payload)
    })

    void (async () => {
      try {
        const [authState, appInfo, settings] = await Promise.all([
          invoke('auth:state'),
          invoke('app:info'),
          invoke('settings:get'),
        ])
        if (!alive) return
        document.documentElement.dataset['theme'] = settings.theme
        // The snapshot may be older than an event that landed while it was in
        // flight (a restored session goes ready during startup) — never let the
        // late answer step the window back to an earlier screen.
        if (!sawAuthEvent.current) setAuth(authState)
        setInfo(appInfo)
      } catch (cause) {
        if (alive) setError(errorMessage(cause))
      }
    })()

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const requestQr = useCallback(async (): Promise<void> => {
    if (qrRequested.current) return
    qrRequested.current = true
    qrAbandoned.current = false
    try {
      // The `waitQr` state arrives on `evt:auth`. Never copy the response over it:
      // TDLib may answer before the state update, and the stale waitPhoneNumber
      // would then hide the QR until the next link refresh.
      await invoke('auth:qr')
    } catch (cause) {
      if (!qrAbandoned.current) setError(errorMessage(cause))
    }
  }, [])

  // QR is the default method: ask TDLib for a code as soon as it waits for us.
  // A fresh `waitPhoneNumber` episode (first run, after 切换账号, after a reset)
  // starts a new request; a repeated state does not.
  useEffect(() => {
    if (auth?.kind !== 'waitPhoneNumber') {
      qrRequested.current = false
      return
    }
    if (mode !== 'qr') return
    void requestQr()
  }, [auth?.kind, mode, requestQr])

  // First login on a blocked network: TDLib needs the proxy before it can mint
  // a QR link. Do not nag immediately, but do not spin forever in silence either.
  const qrPending = auth?.kind === 'waitPhoneNumber' && mode === 'qr'
  useEffect(() => {
    if (!qrPending) {
      setSlowQr(false)
      return
    }
    const timer = window.setTimeout(() => setSlowQr(true), 8_000)
    return () => window.clearTimeout(timer)
  }, [qrPending])

  const step = auth ? stepOf(auth) : 'phone'
  const ready = auth?.kind === 'ready'
  const booting = auth === null || auth.kind === 'idle'
  const closed = auth?.kind === 'closed'
  const isMock = info?.adapter === 'mock'
  const qrLink = auth?.kind === 'waitQr' ? auth.link : null
  const phoneEntry = auth?.kind === 'waitPhoneNumber' && mode === 'phone'

  // The field is disabled while a step is in flight, which drops focus; put the
  // caret back when the next step arrives so the whole login stays typing-only.
  useEffect(() => {
    if (!ready) inputRef.current?.focus()
  }, [step, ready, mode, booting, closed])

  const submit = async (): Promise<void> => {
    if (busy || !value.trim() || !auth) return
    setBusy(true)
    setError(null)
    try {
      const next =
        step === 'phone'
          ? await invoke('auth:start', { phone: value.trim() })
          : step === 'code'
            ? await invoke('auth:code', { code: value.trim() })
            : step === 'register'
              ? await invoke('auth:signup', { firstName: value.trim() })
              : await invoke('auth:password', { password: value })
      setAuth(next)
      setValue('')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  /** 进入 WeGram on the restored-session profile step. */
  const enter = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await invoke('login:enter')
      // Deliberately no `setBusy(false)`: on success this window is about to be
      // destroyed by the main process.
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  /** 切换账号: sign out, which returns the window to the QR screen. */
  const switchAccount = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await invoke('auth:logout')
      setValue('')
      setMode('qr')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 用手机号登录. A pending QR confirmation cannot be cancelled through TDLib,
   * so main restarts the auth client; this window then shows the phone form on
   * the fresh `waitPhoneNumber` state.
   */
  const switchToPhone = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    qrAbandoned.current = true
    // Switch the mode *before* the restart: the reset emits a fresh
    // `waitPhoneNumber` while the QR request state is still in transit, and with
    // mode 'qr' the auto-request effect would immediately ask for another QR.
    setMode('phone')
    try {
      // The new `waitPhoneNumber` state arrives on `evt:auth`; the response is
      // only the snapshot taken when the restart finished.
      await invoke('auth:reset')
    } catch (cause) {
      qrAbandoned.current = false
      setMode('qr')
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const showQr = (): void => {
    setError(null)
    setMode('qr')
  }

  const retryQr = (): void => {
    qrRequested.current = false
    setError(null)
    void requestQr()
  }

  const close = (): void => {
    // The window is destroyed while the invoke is in flight, so the rejection is
    // expected and there is nothing left to show it on.
    void invoke('login:close').catch(() => undefined)
  }

  return {
    auth,
    info,
    mode,
    value,
    setValue,
    busy,
    error,
    setError,
    step,
    ready,
    booting,
    closed,
    isMock,
    qrLink,
    qrPending,
    phoneEntry,
    slowQr,
    inputRef,
    submit,
    enter,
    switchAccount,
    switchToPhone,
    showQr,
    retryQr,
    close,
  }
}
