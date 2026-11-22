import type { ProxyDraft } from '../../lib/proxyDraft'
import { describeProxy, draftFromConfig, EMPTY_DRAFT, toProxyConfig } from '../../lib/proxyDraft'

import { useState } from 'react'

import { Switch } from '../Switch'
import { ProxyFields } from './ProxyFields'
import { useProxySettings } from './useProxySettings'

interface ProxyFormProps {
  /**
   * Where a load failure is reported. The login window hands in its own error line;
   * the settings window's 网络与代理 panel does the same.
   */
  onError?: (message: string) => void
}

/**
 * 代理设置 in the login window's 280 px modal (design doc §6.4).
 *
 * The same two decisions as 设置 → 网络与代理 — 是否跟随系统代理, and the manual
 * endpoint — at the width a modal has: the panel's proxy list needs room, so this
 * one shows the system state as a sentence and the editor directly.
 */
export function ProxyForm({ onError }: ProxyFormProps) {
  const proxy = useProxySettings(onError)
  const [draft, setDraft] = useState<ProxyDraft>(EMPTY_DRAFT)
  const [loadedConfig, setLoadedConfig] = useState<string | null>(null)

  const mode = proxy.state?.mode ?? 'system'
  const config = proxy.state?.config ?? null
  const system = proxy.state?.system ?? null
  const active = proxy.state?.active ?? null

  // Fill the fields once per stored configuration: a refresh of the state must not
  // overwrite what is being typed.
  const configKey = config ? JSON.stringify(config) : null
  if (config && configKey !== loadedConfig) {
    setLoadedConfig(configKey)
    setDraft(draftFromConfig(config))
  }

  const save = async (): Promise<void> => {
    const next = toProxyConfig(draft)
    if (!next) {
      proxy.setStatus({ kind: 'fail', text: '请填写服务器与端口' })
      return
    }
    await proxy.save(next)
  }

  const test = async (): Promise<void> => {
    const next = toProxyConfig(draft)
    if (!next) {
      proxy.setStatus({ kind: 'fail', text: '请填写服务器与端口' })
      return
    }
    await proxy.test(next)
  }

  const toggleSystem = async (next: boolean): Promise<void> => {
    await proxy.setMode(next ? 'system' : config ? 'manual' : 'off')
  }

  return (
    <>
      <div className="wx-switch-row">
        <span>使用系统代理</span>
        <Switch
          checked={mode === 'system'}
          label="使用系统代理"
          onChange={(next) => void toggleSystem(next)}
        />
      </div>

      {mode === 'system' ? (
        <>
          <div className="wx-hint">
            {system ? `系统代理 ${describeProxy(system)}` : '系统未配置代理'}
            ；当前{active ? `使用 ${describeProxy(active)}` : '直连'}。
          </div>
          <div className="wx-row">
            <button className="wx-button wx-button--ghost" onClick={() => void proxy.refresh()}>
              重新检测
            </button>
          </div>
        </>
      ) : (
        <>
          <ProxyFields
            draft={draft}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          />
          <div className="wx-row">
            <button className="wx-button" onClick={() => void save()}>
              保存并应用
            </button>
            <button className="wx-button wx-button--ghost" onClick={() => void test()}>
              测试连通性
            </button>
          </div>
        </>
      )}

      <div className="wx-switch-row">
        <span>优先使用 IPv6</span>
        <Switch
          checked={proxy.preferIpv6}
          label="优先使用 IPv6"
          onChange={(next) => void proxy.toggleIpv6(next)}
        />
      </div>

      {proxy.status.kind !== 'idle' ? (
        <div
          className={`wx-status${proxy.status.kind === 'ok' ? ' wx-status--ok' : ''}${
            proxy.status.kind === 'fail' ? ' wx-status--fail' : ''
          }`}
        >
          {proxy.status.kind === 'busy' ? '处理中…' : proxy.status.text}
        </div>
      ) : null}
    </>
  )
}
