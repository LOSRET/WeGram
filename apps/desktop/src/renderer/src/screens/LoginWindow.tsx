import { useState } from 'react'
import { CloseIcon, SettingsGearIcon, TelegramLogo } from '@renderer/components/Icon'
import { ProxyPanel } from '@renderer/components/ProxyPanel'

import { LoginFooter } from './login/LoginFooter'
import { LoginHelp } from './login/LoginHelp'
import { PhoneForm } from './login/PhoneForm'
import { ProfileStep } from './login/ProfileStep'
import { QrStep } from './login/QrStep'
import { loginCopy } from './login/loginCopy'
import { useLoginFlow } from './login/useLoginFlow'

type Panel = 'proxy' | 'help' | null

/**
 * The login window (design doc §9.6): the whole sign-in flow, in its own
 * 280×373 frameless window, before the shell exists at all.
 *
 * This component is the window's chrome and its four bodies; the flow itself
 * lives in `useLoginFlow`, the copy in `loginCopy` and each step in its own
 * module under `login/`. The window owns no chat state: it only follows auth
 * events, so the two windows never both hydrate the chat store.
 */
export function LoginWindow() {
  const flow = useLoginFlow()
  const [panel, setPanel] = useState<Panel>(null)
  const copy = loginCopy(flow.step, flow.auth)

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
          onClick={flow.close}
        >
          <CloseIcon size={12} />
        </button>
      </div>

      {flow.booting ? (
        <div className="wx-login__body wx-login__body--center">
          <TelegramLogo size={64} className="wx-login__mark" />
          <div className="wx-login__spinner">
            <span className="wx-spinner" />
          </div>
          <div className="wx-login__subtitle">正在连接 Telegram…</div>
          {flow.error ? (
            <div className="wx-login__feedback">
              <span className="wx-login__error">{flow.error}</span>
            </div>
          ) : null}
        </div>
      ) : flow.closed ? (
        <div className="wx-login__body wx-login__body--center">
          <TelegramLogo size={64} className="wx-login__mark wx-login__mark--muted" />
          <div className="wx-login__title">连接已关闭</div>
          <div className="wx-login__subtitle">
            与 Telegram 的连接已断开，重新打开 WeGram 就能再试。
          </div>
        </div>
      ) : flow.ready && flow.auth?.kind === 'ready' ? (
        <ProfileStep me={flow.auth.me} busy={flow.busy} onEnter={() => void flow.enter()} />
      ) : flow.qrLink !== null || flow.qrPending ? (
        <QrStep
          link={flow.qrLink}
          isMock={flow.isMock}
          error={flow.error}
          slowQr={flow.slowQr}
          onRetry={flow.retryQr}
        />
      ) : (
        <PhoneForm
          step={flow.step}
          copy={copy}
          value={flow.value}
          busy={flow.busy}
          error={flow.error}
          isMock={flow.isMock}
          inputRef={flow.inputRef}
          onChange={flow.setValue}
          onSubmit={() => void flow.submit()}
        />
      )}

      <LoginFooter
        ready={flow.ready}
        qrLink={flow.qrLink}
        qrPending={flow.qrPending}
        phoneEntry={flow.phoneEntry}
        busy={flow.busy}
        onSwitchAccount={() => void flow.switchAccount()}
        onSwitchToPhone={() => void flow.switchToPhone()}
        onShowQr={flow.showQr}
        onHelp={() => setPanel('help')}
      />

      {panel === 'proxy' ? (
        <ProxyPanel onClose={() => setPanel(null)} onError={flow.setError} />
      ) : null}
      {panel === 'help' ? (
        <LoginHelp isMock={flow.isMock} onClose={() => setPanel(null)} />
      ) : null}
    </div>
  )
}
