import type { ProxyConfig } from '@wechatgram/protocol'

import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'
import { useEffect, useState } from 'react'

interface ProxyPanelProps {
  onClose: () => void
}

type Status = { kind: 'idle' | 'busy' | 'ok' | 'fail'; text?: string }

/** SOCKS5 / MTProxy settings, including a one-shot connectivity test (§6.4). */
export function ProxyPanel({ onClose }: ProxyPanelProps) {
  const setError = useAppStore((state) => state.setError)

  const [type, setType] = useState<'socks5' | 'mtproto'>('socks5')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('1080')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    void (async () => {
      try {
        const config = await invoke('proxy:get')
        if (!config) return
        setType(config.type)
        setHost(config.host)
        setPort(String(config.port))
        if (config.type === 'socks5') {
          setUsername(config.username ?? '')
          setPassword(config.password ?? '')
        } else {
          setSecret(config.secret ?? '')
        }
      } catch (error) {
        setError(errorMessage(error))
      }
    })()
  }, [setError])

  const buildConfig = (): ProxyConfig | null => {
    if (!host.trim() || !Number(port)) return null
    if (type === 'socks5') {
      return {
        type: 'socks5',
        host: host.trim(),
        port: Number(port),
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
      }
    }
    return {
      type: 'mtproto',
      host: host.trim(),
      port: Number(port),
      ...(secret ? { secret: secret.trim() } : {}),
    }
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
    <div className="wx-modal-backdrop" onClick={onClose}>
      <div className="wx-modal" onClick={(event) => event.stopPropagation()}>
        <div className="wx-modal__header">
          <span>设置 · 代理</span>
          <button className="wx-icon-button" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="wx-field">
          <label htmlFor="proxy-type">类型</label>
          <select
            id="proxy-type"
            className="wx-input"
            value={type}
            onChange={(event) => setType(event.target.value === 'mtproto' ? 'mtproto' : 'socks5')}
          >
            <option value="socks5">SOCKS5</option>
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
              placeholder="127.0.0.1"
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

        {type === 'socks5' ? (
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
          加密保存，渲染层只拿掩码。
        </div>
      </div>
    </div>
  )
}
