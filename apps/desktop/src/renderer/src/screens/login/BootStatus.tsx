import type { BootState } from '@wegram/protocol'
import { TelegramLogo } from '@renderer/components/Icon'

import { bootCopy } from './bootCopy'

/**
 * The startup panel: the logo, a spinner while something is being tried, and —
 * once TDLib has failed or died — the reason with the spinner gone. It replaces
 * the single «正在连接 Telegram…» line that covered every phase, including the
 * ones the app could never leave.
 */
export function BootStatus({
  boot,
  closed,
  error,
}: {
  boot: BootState | null
  closed: boolean
  error: string | null
}) {
  const copy = bootCopy(boot, closed, error)
  const failed = copy.tone === 'failed'

  return (
    <div className="wx-login__body wx-login__body--center">
      <TelegramLogo
        size={64}
        className={`wx-login__mark${failed ? ' wx-login__mark--muted' : ''}`}
      />
      {failed ? null : (
        <div className="wx-login__spinner">
          <span className="wx-spinner" />
        </div>
      )}
      <div className="wx-login__title">{copy.title}</div>
      <div className="wx-login__subtitle">{copy.subtitle}</div>
      {copy.detail ? (
        <div className="wx-login__feedback">
          <span className="wx-login__error">{copy.detail}</span>
        </div>
      ) : null}
      {copy.hint ? <div className="wx-login__boot-hint">{copy.hint}</div> : null}
    </div>
  )
}
