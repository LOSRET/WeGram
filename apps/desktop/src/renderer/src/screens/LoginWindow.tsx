import type { AppInfo, AuthState } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CloseIcon, SettingsGearIcon, TelegramLogo } from '@renderer/components/Icon'
import { ProxyPanel } from '@renderer/components/ProxyPanel'
import { QrCode } from '@renderer/components/QrCode'
import { avatarColor, initials } from '@renderer/lib/format'
import { errorMessage, invoke } from '@renderer/lib/ipc'

import { displayName, stepOf, type LoginStep as Step } from './loginModel'

type Panel = 'proxy' | 'help' | null
/** Which method the window shows while TDLib is still waiting for a phone. */
type Mode = 'qr' | 'phone'

/**
 * The login window (design doc §9.6): the whole sign-in flow, in its own
 * 280×373 frameless window, before the shell exists at all.
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
export function LoginWindow() {
  /** `null` until `auth:state` answers: the form must not flash before we know. */
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [mode, setMode] = useState<Mode>('qr')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  /** QR request has been waiting long enough to be worth a proxy hint. */
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

  const step = auth ? stepOf(auth) : 'phone'
  const ready = auth?.kind === 'ready'
  const booting = auth === null || auth.kind === 'idle'
  const closed = auth?.kind === 'closed'
  const isMock = info?.adapter === 'mock'
  const qrLink = auth?.kind === 'waitQr' ? auth.link : null
  const qrPending = auth?.kind === 'waitPhoneNumber' && mode === 'qr'
  const phoneEntry = auth?.kind === 'waitPhoneNumber' && mode === 'phone'

  // First login on a blocked network: TDLib needs the proxy before it can mint
  // a QR link. Do not nag immediately, but do not spin forever in silence either.
  useEffect(() => {
    if (!qrPending) {
      setSlowQr(false)
      return
    }
    const timer = window.setTimeout(() => setSlowQr(true), 8_000)
    return () => window.clearTimeout(timer)
  }, [qrPending])

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

  const labels: Record<
    Step,
    { title: string; subtitle: string; placeholder: string; action: string; label: string }
  > = {
    phone: {
      title: '登录 Telegram',
      subtitle: '用你的手机号登录，验证码会发到 Telegram 客户端。',
      placeholder: '+8613800000000',
      action: '下一步',
      label: '手机号',
    },
    code: {
      title: '输入验证码',
      subtitle:
        auth?.kind === 'waitCode' && auth.hint
          ? `验证码已发送：${auth.hint}`
          : '验证码已发送，请输入收到的数字。',
      placeholder:
        auth?.kind === 'waitCode' && auth.codeLength ? `${auth.codeLength} 位数字` : '验证码',
      action: '确认',
      label: '验证码',
    },
    password: {
      title: '两步验证',
      subtitle:
        auth?.kind === 'waitPassword' && auth.hint
          ? `需要两步验证密码（提示：${auth.hint}）`
          : '该账号开启了两步验证，请输入密码。',
      placeholder: '两步验证密码',
      action: '登录',
      label: '两步验证密码',
    },
  }

  const copy = labels[step]

  return (
    <div className="wx-login">
      <div className="wx-login__titlebar">
        <span className="wx-login__name">WeGram</span>
        <button
          className="wx-login__tool"
          type="button"
          title="设置"
          aria-label="设置"
          onClick={() => setPanel('proxy')}
        >
          <SettingsGearIcon size={14} />
        </button>
        <button
          className="wx-login__tool"
          type="button"
          title="关闭"
          aria-label="关闭"
          onClick={close}
        >
          <CloseIcon size={12} />
        </button>
      </div>

      {booting ? (
        <div className="wx-login__body wx-login__body--center">
          <TelegramLogo size={64} className="wx-login__mark" />
          <div className="wx-login__spinner">
            <span className="wx-spinner" />
          </div>
          <div className="wx-login__subtitle">正在连接 Telegram…</div>
          {error ? (
            <div className="wx-login__feedback">
              <span className="wx-login__error">{error}</span>
            </div>
          ) : null}
        </div>
      ) : closed ? (
        <div className="wx-login__body wx-login__body--center">
          <TelegramLogo size={64} className="wx-login__mark wx-login__mark--muted" />
          <div className="wx-login__title">连接已关闭</div>
          <div className="wx-login__subtitle">
            与 Telegram 的连接已断开，重新打开 WeGram 就能再试。
          </div>
        </div>
      ) : ready && auth.kind === 'ready' ? (
        <div className="wx-login__body wx-login__body--profile">
          {auth.me.avatarUrl ? (
            <img className="wx-login__avatar" src={auth.me.avatarUrl} alt="" draggable={false} />
          ) : (
            <div
              className="wx-login__avatar wx-login__avatar--empty"
              style={{ background: avatarColor(auth.me.id) }}
            >
              {initials(displayName(auth.me))}
            </div>
          )}
          <div className="wx-login__profile-name">{displayName(auth.me)}</div>
          <button
            className="wx-login__button"
            type="button"
            disabled={busy}
            onClick={() => void enter()}
          >
            {busy ? '正在进入…' : '进入 WeGram'}
          </button>
        </div>
      ) : qrLink ? (
        <div className="wx-login__body wx-login__body--qr">
          <QrCode value={qrLink} />
          <div className="wx-login__qr-label">扫码登录</div>
          <div className="wx-login__qr-hint">用手机 Telegram 扫描二维码</div>
          {isMock ? (
            <div className="wx-login__qr-mock">Mock 适配器：10 秒后自动模拟扫码</div>
          ) : null}
          {error ? (
            <div className="wx-login__feedback">
              <span className="wx-login__error">{error}</span>
            </div>
          ) : null}
        </div>
      ) : qrPending ? (
        <div className="wx-login__body wx-login__body--qr">
          <div className="wx-login__qr-placeholder">
            <span className="wx-spinner" />
          </div>
          <div className="wx-login__qr-label">扫码登录</div>
          <div className={`wx-login__qr-hint${error ? ' wx-login__qr-hint--error' : ''}`}>
            {error ?? '正在获取二维码…'}
          </div>
          {!error && slowQr ? (
            <div className="wx-login__qr-mock">
              一直停在这里？点标题栏的齿轮设置代理，或改用手机号登录。
            </div>
          ) : null}
          {error ? (
            <button className="wx-login__link wx-login__qr-retry" type="button" onClick={retryQr}>
              重新获取二维码
            </button>
          ) : null}
        </div>
      ) : (
        <form
          className="wx-login__body"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <TelegramLogo size={64} className="wx-login__mark" />
          <div className="wx-login__title">{copy.title}</div>
          <div className="wx-login__subtitle">{copy.subtitle}</div>
          <input
            id="login-input"
            ref={inputRef}
            className="wx-login__input"
            autoFocus
            type={step === 'password' ? 'password' : 'text'}
            autoComplete={step === 'password' ? 'new-password' : 'off'}
            inputMode={step === 'code' ? 'numeric' : undefined}
            aria-label={copy.label}
            placeholder={copy.placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
          />
          <button className="wx-login__button" type="submit" disabled={busy || !value.trim()}>
            {busy ? '请稍候…' : copy.action}
          </button>
          <div className="wx-login__feedback" role="status">
            {error ? (
              <span className="wx-login__error">{error}</span>
            ) : isMock ? (
              <span className="wx-login__hint">Mock · 验证码 12345 · 密码 wegram</span>
            ) : null}
          </div>
        </form>
      )}

      <div className="wx-login__footer">
        {ready ? (
          <>
            <button
              className="wx-login__link"
              type="button"
              disabled={busy}
              onClick={() => void switchAccount()}
            >
              切换账号
            </button>
            <span className="wx-login__sep" aria-hidden="true" />
          </>
        ) : null}
        {qrLink || qrPending ? (
          <>
            <button
              className="wx-login__link"
              type="button"
              disabled={busy}
              onClick={() => void switchToPhone()}
            >
              用手机号登录
            </button>
            <span className="wx-login__sep" aria-hidden="true" />
          </>
        ) : null}
        {phoneEntry ? (
          <>
            <button className="wx-login__link" type="button" onClick={showQr}>
              返回扫码
            </button>
            <span className="wx-login__sep" aria-hidden="true" />
          </>
        ) : null}
        <button className="wx-login__link" type="button" onClick={() => setPanel('help')}>
          登录帮助
        </button>
      </div>

      {panel === 'proxy' ? <ProxyPanel onClose={() => setPanel(null)} onError={setError} /> : null}
      {panel === 'help' ? <LoginHelp isMock={isMock} onClose={() => setPanel(null)} /> : null}
    </div>
  )
}

/**
 * 登录帮助: how to confirm the QR, when the phone form is needed, and the mock
 * credentials. The mock note lives here instead of the window body so the code
 * keeps the client's sparse layout.
 */
function LoginHelp({ isMock, onClose }: { isMock: boolean; onClose: () => void }) {
  return (
    <div className="wx-modal-backdrop" onClick={onClose}>
      <div
        className="wx-modal"
        role="dialog"
        aria-modal="true"
        aria-label="登录帮助"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wx-modal__header">
          <span>登录帮助</span>
          <button className="wx-icon-button" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <p className="wx-login__help-text">
          扫码登录：手机 Telegram 打开「设置 → 设备 →
          关联桌面设备」，扫描窗口里的二维码，再在手机上确认。
        </p>
        <p className="wx-login__help-text">
          一直停在「正在获取二维码」时，点标题栏的齿轮设置 SOCKS5 或 MTProxy 代理——Telegram
          要先能连上网络。
        </p>
        <p className="wx-login__help-text">
          没有可扫码的手机时，点「用手机号登录」：验证码会发到已登录的 Telegram
          客户端，两步验证密码在「隐私与安全 → 两步验证」里设置。
        </p>
        {isMock ? (
          <p className="wx-login__help-text">
            当前是 Mock 适配器：二维码 10 秒后自动确认；手机号以 + 开头即可，验证码{' '}
            <code>12345</code>，两步密码 <code>wegram</code>。
          </p>
        ) : null}
      </div>
    </div>
  )
}
