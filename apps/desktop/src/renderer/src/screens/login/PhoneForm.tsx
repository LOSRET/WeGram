import type { RefObject } from 'react'
import { TelegramLogo } from '@renderer/components/Icon'

import type { LoginStep } from '../loginModel'
import type { LoginCopy } from './loginCopy'

/**
 * The phone / code / password form. One input whose shape follows the step —
 * the whole login is typing-only, which is why the caret is put back on every
 * step change by `useLoginFlow`.
 */
export function PhoneForm({
  step,
  copy,
  value,
  busy,
  error,
  isMock,
  inputRef,
  onChange,
  onSubmit,
}: {
  step: LoginStep
  copy: LoginCopy
  value: string
  busy: boolean
  error: string | null
  isMock: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onChange: (next: string) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="wx-login__body"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
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
        onChange={(event) => onChange(event.target.value)}
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
  )
}
