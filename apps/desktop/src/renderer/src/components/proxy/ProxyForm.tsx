import type { ProxyConfig } from '@wegram/protocol'

import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'
import { Switch } from '../Switch'

type Status = { kind: 'idle' | 'busy' | 'ok' | 'fail'; text?: string }

interface ProxyFormProps {
  /**
   * Where a load failure is reported. The login window hands in its own error line;
   * the settings window's 网络与代理 panel does the same.
   */
  onError?: (message: string) => void
}

/**
 * SOCKS5 / HTTP / MTProxy fields, the one-shot connectivity test and the IPv6
 * switch (design doc §6.4). Extracted from `ProxyPanel` when 设置 became a window:
 * the login window shows it in a modal, 设置 → 网络与代理 shows the same controls
 * inline, and there must not be two copies of a form that writes TDLib's proxy.
 */
export function ProxyForm({ onError }: ProxyFormProps) {
  const setError = useAppStore((state) => state.setError)

  const [type, setType] = useState<'socks5' | 'http' | 'mtproto'>('socks5')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('1080')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState('')
  const [preferIpv6, setPreferIpv6] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    void (async () => {
      try {
        const [config, network] = await Promise.all([invoke('proxy:get'), invoke('network:get')])
        setPreferIpv6(network.preferIpv6)
        if (!config) return
        setType(config.type)
        setHost(config.host)
        setPort(String(config.port))
        if (config.type === 'mtproto') {
          setSecret(config.secret ?? '')
        } else {
          setUsername(config.username ?? '')
          setPassword(config.password ?? '')
        }
      } catch (error) {
        const report = onError ?? setError
        report(errorMessage(error))
      }
    })()
  }, [onError, setError])

  const buildConfig = (): ProxyConfig | null => {
    if (!host.trim() || !Number(port)) return null
    if (type === 'mtproto') {
      return {
        type: 'mtproto',
        host: host.trim(),
        port: Number(port),
        ...(secret ? { secret: secret.trim() } : {}),
      }
    }
    const credentials = {
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    }
    return type === 'http'
      ? { type: 'http', host: host.trim(), port: Number(port), ...credentials }
      : { type: 'socks5', host: host.trim(), port: Number(port), ...credentials }
  }

  const save = async () => {
    const config = buildConfig()
    if (!config) {
      setStatus({ kind: 'fail', text: '请填写主机与端口' })
      return
    }
    setStatus({ kind: 'busy' })
    try {
      await invoke('proxy:set', { config })
      setStatus({ kind: 'ok', text: '已保存并应用到 TDLib' })
    } catch (error) {
      setStatus({ kind: 'fail', text: errorMessage(error) })
    }
  }

  const clear = async () => {
    setStatus({ kind: 'busy' })
    try {
      await invoke('proxy:set', { config: null })
      setHost('')
      setPort('1080')
      setUsername('')
      setPassword('')
      setSecret('')
      setStatus({ kind: 'ok', text: '代理已关闭' })
    } catch (error) {
      setStatus({ kind: 'fail', text: errorMessage(error) })
    }
  }

  const toggleIpv6 = async (next: boolean) => {
    setPreferIpv6(next)
    try {
      await invoke('network:set', { preferIpv6: next })
    } catch (error) {
      setPreferIpv6(!next)
      setStatus({ kind: 'fail', text: errorMessage(error) })
    }
  }

  const test = async () => {
    const config = buildConfig()
    if (!config) {
      setStatus({ kind: 'fail', text: '请填写主机与端口' })
      return
    }
    setStatus({ kind: 'busy' })
    try {
      const result = await invoke('proxy:test', { config })
      setStatus(
        result.ok
          ? { kind: 'ok', text: `连通，耗时 ${result.latencyMs ?? 0}ms` }
          : { kind: 'fail', text: result.error ?? '连接失败' },
      )
    } catch (error) {
      setStatus({ kind: 'fail', text: errorMessage(error) })
    }
  }

  return (
    <>
      <div className="wx-field">
        <label htmlFor="proxy-type">类型</label>
        <select
          id="proxy-type"
          className="wx-input"
          value={type}
          onChange={(event) => {
            const next = event.target.value
            setType(next === 'mtproto' ? 'mtproto' : next === 'http' ? 'http' : 'socks5')
          }}
        >
          <option value="socks5">SOCKS5</option>
          <option value="http">HTTP</option>
          <option value="mtproto">MTProxy</option>
        </select>
      </div>

      <div className="wx-row">
        <div className="wx-field">
          <label htmlFor="proxy-host">主机</label>
          <input
            id="proxy-host"
            className="wx-input"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="127.0.0.1 或 ::1"
          />
        </div>
        <div className="wx-field">
          <label htmlFor="proxy-port">端口</label>
          <input
            id="proxy-port"
            className="wx-input"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            placeholder="1080"
          />
        </div>
      </div>

      {type !== 'mtproto' ? (
        <div className="wx-row">
          <div className="wx-field">
            <label htmlFor="proxy-user">用户名（可选）</label>
            <input
              id="proxy-user"
              className="wx-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="wx-field">
            <label htmlFor="proxy-password">密码（已保存则显示 ***）</label>
            <input
              id="proxy-password"
              className="wx-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="wx-field">
          <label htmlFor="proxy-secret">MTProxy secret（十六进制，已保存则显示 ***）</label>
          <input
            id="proxy-secret"
            className="wx-input"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </div>
      )}

      <div className="wx-switch-row">
        <span>优先使用 IPv6（prefer_ipv6）</span>
        <Switch
          checked={preferIpv6}
          label="优先使用 IPv6"
          onChange={(next) => void toggleIpv6(next)}
        />
      </div>

      {status.kind !== 'idle' ? (
        <div
          className={`wx-status${status.kind === 'ok' ? ' wx-status--ok' : ''}${
            status.kind === 'fail' ? ' wx-status--fail' : ''
          }`}
        >
          {status.kind === 'busy' ? '处理中…' : status.text}
        </div>
      ) : null}

      <div className="wx-row">
        <button className="wx-button" onClick={() => void save()}>
          保存并应用
        </button>
        <button className="wx-button wx-button--ghost" onClick={() => void test()}>
          测试连通性
        </button>
        <button className="wx-button wx-button--ghost" onClick={() => void clear()}>
          关闭代理
        </button>
      </div>

      <div className="wx-hint">
        代理在 TDLib 初始化参数之后、任何网络请求之前应用；密码与 secret 通过 Windows DPAPI
        加密保存，渲染层只拿掩码。HTTP 代理按 CONNECT 隧道承载 Telegram 流量（不支持 TLS
        到代理本身）。「测试连通性」用 TDLib 的 pingProxy 临时连一次，不会打断当前连接。 IPv6
        默认关闭：网络或代理只有 IPv6 时再打开，路由不完整时反而更慢。
      </div>
    </>
  )
}
