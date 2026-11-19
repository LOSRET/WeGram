/**
 * The window's link row. Which links exist depends on where the flow is: 切换账号
 * only once an account is known, 用手机号登录 only while a QR is on screen,
 * 返回扫码 only on the phone form.
 */
export function LoginFooter({
  ready,
  qrLink,
  qrPending,
  phoneEntry,
  busy,
  onSwitchAccount,
  onSwitchToPhone,
  onShowQr,
  onHelp,
}: {
  ready: boolean
  qrLink: string | null
  qrPending: boolean
  phoneEntry: boolean
  busy: boolean
  onSwitchAccount: () => void
  onSwitchToPhone: () => void
  onShowQr: () => void
  onHelp: () => void
}) {
  return (
    <div className="wx-login__footer">
      {ready ? (
        <>
          <button
            className="wx-login__link"
            type="button"
            disabled={busy}
            onClick={onSwitchAccount}
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
            onClick={onSwitchToPhone}
          >
            用手机号登录
          </button>
          <span className="wx-login__sep" aria-hidden="true" />
        </>
      ) : null}
      {phoneEntry ? (
        <>
          <button className="wx-login__link" type="button" onClick={onShowQr}>
            返回扫码
          </button>
          <span className="wx-login__sep" aria-hidden="true" />
        </>
      ) : null}
      <button className="wx-login__link" type="button" onClick={onHelp}>
        登录帮助
      </button>
    </div>
  )
}
