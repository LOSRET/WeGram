import { Modal } from '../../components/Modal'

/**
 * 登录帮助: how to confirm the QR, when the phone form is needed, and the mock
 * credentials. The mock note lives here instead of the window body so the code
 * keeps the client's sparse layout.
 */
export function LoginHelp({ isMock, onClose }: { isMock: boolean; onClose: () => void }) {
  return (
    <Modal label="登录帮助" onClose={onClose}>
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
          当前是 Mock 适配器：二维码 10 秒后自动确认；手机号以 + 开头即可，验证码 <code>12345</code>
          ，两步密码 <code>wegram</code>。
        </p>
      ) : null}
    </Modal>
  )
}
