import type { AuthState } from '@wegram/protocol'

import { errorMessage, invoke } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/useAppStore'
import { TelegramLogo } from '@renderer/components/Icon'
import { useEffect, useRef, useState } from 'react'

type Step = 'phone' | 'code' | 'password'

function stepOf(auth: AuthState): Step {
  switch (auth.kind) {
    case 'waitCode':
      return 'code'
    case 'waitPassword':
      return 'password'
    default:
      return 'phone'
  }
}

export function LoginScreen() {
  const auth = useAppStore((state) => state.auth)
  const info = useAppStore((state) => state.info)
  const setAuth = useAppStore((state) => state.setAuth)
  const setError = useAppStore((state) => state.setError)

  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const step = stepOf(auth)
  const isMock = info?.adapter === 'mock'

  // The field is disabled while a step is in flight, which drops focus; put the
  // caret back when the next step arrives so the whole login stays typing-only.
  useEffect(() => {
    inputRef.current?.focus()
  }, [auth.kind])

  const submit = async () => {
    if (busy || !value.trim()) return
    setBusy(true)
    setLocalError(null)
    try {
      const next =
        step === 'phone'
          ? await invoke('auth:start', { phone: value.trim() })
          : step === 'code'
            ? await invoke('auth:code', { code: value.trim() })
            : await invoke('auth:password', { password: value })
      setAuth(next)
      setValue('')
      if (next.kind === 'ready') setError(null)
    } catch (error) {
      setLocalError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const labels: Record<
    Step,
    { title: string; subtitle: string; placeholder: string; action: string }
  > = {
    phone: {
      title: '登录 Telegram',
      subtitle: '用你的手机号登录，验证码会发到 Telegram 客户端。',
      placeholder: '+8613800000000',
      action: '下一步',
    },
    code: {
      title: '输入验证码',
      subtitle:
        auth.kind === 'waitCode' && auth.hint ? `验证码已发送：${auth.hint}` : '验证码已发送。',
      placeholder:
        auth.kind === 'waitCode' && auth.codeLength ? `${auth.codeLength} 位数字` : '验证码',
      action: '确认',
    },
    password: {
      title: '两步验证',
      subtitle:
        auth.kind === 'waitPassword' && auth.hint
          ? `需要两步验证密码（提示：${auth.hint}）`
          : '该账号开启了两步验证，请输入密码。',
      placeholder: '两步验证密码',
      action: '登录',
    },
  }

  const copy = labels[step]

  return (
    <div className="wx-login">
      <form
        className="wx-login__card"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <TelegramLogo size={56} className="wx-login__logo" />
        <div className="wx-login__title">{copy.title}</div>
        <div className="wx-login__subtitle">{copy.subtitle}</div>

        <div className="wx-field">
          <label htmlFor="login-input">
            {step === 'phone' ? '手机号' : step === 'code' ? '验证码' : '密码'}
          </label>
          <input
            id="login-input"
            ref={inputRef}
            className="wx-input"
            autoFocus
            type={step === 'password' ? 'password' : 'text'}
            autoComplete={step === 'password' ? 'new-password' : 'off'}
            inputMode={step === 'code' ? 'numeric' : undefined}
            placeholder={copy.placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
          />
        </div>

        {localError ? <div className="wx-error">{localError}</div> : null}

        {isMock ? (
          <div className="wx-hint">
            当前是 <strong>Mock 适配器</strong>（未检测到 TELEGRAM_API_ID / TELEGRAM_API_HASH）。
            手机号随意但需以 + 开头，验证码 <code>12345</code>，两步验证密码 <code>wegram</code>
            。
          </div>
        ) : null}

        <button className="wx-button" type="submit" disabled={busy || !value.trim()}>
          {busy ? '请稍候…' : copy.action}
        </button>
      </form>
    </div>
  )
}
