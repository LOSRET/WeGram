import { useState } from 'react'
import { CloseIcon, SettingsGearIcon } from '@renderer/components/Icon'
import { ProxyPanel } from '@renderer/components/ProxyPanel'

import { BootStatus } from './login/BootStatus'
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
 * lives in `useLoginFlow`, the copy in `loginCopy` / `bootCopy` and each step in
 * its own module under `login/`. The window owns no chat state: it only follows auth
 * events, so the two windows never both hydrate the chat store.
 */
export function LoginWindow() {
  const flow = useLoginFlow()
  const [panel, setPanel] = useState<Panel>(null)
  const copy = loginCopy(flow.step, flow.auth)
  /** A terminal startup phase: the spinner is gone and the reason takes over. */
  const bootDown = flow.boot?.kind === 'failed' || flow.boot?.kind === 'crashed'
  /** Nothing but 登录帮助 is actionable once the client is gone. */
  const terminal = bootDown || flow.closed

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

      {terminal ? (
        <BootStatus boot={flow.boot} closed={flow.closed} error={flow.error} />
      ) : flow.booting ? (
        <BootStatus boot={flow.boot} closed={false} error={flow.error} />
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
        ready={flow.ready && !terminal}
        qrLink={terminal ? null : flow.qrLink}
        qrPending={terminal ? false : flow.qrPending}
        phoneEntry={terminal ? false : flow.phoneEntry}
        busy={flow.busy}
        onSwitchAccount={() => void flow.switchAccount()}
        onSwitchToPhone={() => void flow.switchToPhone()}
        onShowQr={flow.showQr}
        onHelp={() => setPanel('help')}
      />

      {panel === 'proxy' ? (
        <ProxyPanel onClose={() => setPanel(null)} onError={flow.setError} />
      ) : null}
      {panel === 'help' ? <LoginHelp isMock={flow.isMock} onClose={() => setPanel(null)} /> : null}
    </div>
  )
}
