import type { ProxyDraft } from '../../lib/proxyDraft'

interface ProxyFieldsProps {
  draft: ProxyDraft
  onChange: (patch: Partial<ProxyDraft>) => void
  disabled?: boolean
}

/**
 * 类型 / 服务器 / 端口 / 账号 / 密码 — or the MTProxy secret (design doc §6.4).
 *
 * One editor for both surfaces that write TDLib's proxy: the login window's modal
 * and 设置 → 网络与代理. A caller owns the draft; this only paints it.
 */
export function ProxyFields({ draft, onChange, disabled }: ProxyFieldsProps) {
  return (
    <>
      <div className="wx-row">
        <div className="wx-field">
          <label htmlFor="proxy-type">类型</label>
          <select
            id="proxy-type"
            className="wx-input"
            value={draft.type}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value
              onChange({ type: next === 'mtproto' ? 'mtproto' : next === 'http' ? 'http' : 'socks5' })
            }}
          >
            <option value="socks5">SOCKS5</option>
            <option value="http">HTTP</option>
            <option value="mtproto">MTProxy</option>
          </select>
        </div>
        <div className="wx-field">
          <label htmlFor="proxy-port">端口</label>
          <input
            id="proxy-port"
            className="wx-input"
            value={draft.port}
            disabled={disabled}
            inputMode="numeric"
            placeholder="1080"
            onChange={(event) => onChange({ port: event.target.value })}
          />
        </div>
      </div>

      <div className="wx-field">
        <label htmlFor="proxy-host">服务器</label>
        <input
          id="proxy-host"
          className="wx-input"
          value={draft.host}
          disabled={disabled}
          placeholder="127.0.0.1 或 ::1"
          onChange={(event) => onChange({ host: event.target.value })}
        />
      </div>

      {draft.type === 'mtproto' ? (
        <div className="wx-field">
          <label htmlFor="proxy-secret">Secret（十六进制，已保存则显示 ***）</label>
          <input
            id="proxy-secret"
            className="wx-input"
            value={draft.secret}
            disabled={disabled}
            onChange={(event) => onChange({ secret: event.target.value })}
          />
        </div>
      ) : (
        <div className="wx-row">
          <div className="wx-field">
            <label htmlFor="proxy-user">用户名（可选）</label>
            <input
              id="proxy-user"
              className="wx-input"
              value={draft.username}
              disabled={disabled}
              onChange={(event) => onChange({ username: event.target.value })}
            />
          </div>
          <div className="wx-field">
            <label htmlFor="proxy-password">密码（已保存则显示 ***）</label>
            <input
              id="proxy-password"
              className="wx-input"
              type="password"
              value={draft.password}
              disabled={disabled}
              onChange={(event) => onChange({ password: event.target.value })}
            />
          </div>
        </div>
      )}
    </>
  )
}
