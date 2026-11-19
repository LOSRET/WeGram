import { QrCode } from '@renderer/components/QrCode'

/**
 * The QR half of the window: the link TDLib re-issues every few seconds, or the
 * placeholder while it is still being minted.
 *
 * Keep the QR unstyled by theme: a dark-on-dark code does not scan.
 */
export function QrStep({
  link,
  isMock,
  error,
  slowQr,
  onRetry,
}: {
  link: string | null
  isMock: boolean
  error: string | null
  slowQr: boolean
  onRetry: () => void
}) {
  if (link !== null) {
    return (
      <div className="wx-login__body wx-login__body--qr">
        <QrCode value={link} />
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
    )
  }

  return (
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
        <button className="wx-login__link wx-login__qr-retry" type="button" onClick={onRetry}>
          重新获取二维码
        </button>
      ) : null}
    </div>
  )
}
