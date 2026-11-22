import type { ProxyMode } from '@wegram/protocol'

import { useEffect, useRef, useState } from 'react'

import type { ProxyDraft } from '../../lib/proxyDraft'
import { describeProxy, draftFromConfig, EMPTY_DRAFT, toProxyConfig } from '../../lib/proxyDraft'
import { ProxyFields } from '../proxy/ProxyFields'
import { useProxySettings } from '../proxy/useProxySettings'
import { Switch } from '../Switch'
import { SettingsGroup } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'

interface NetworkPanelProps {
  onError: (message: string) => void
}

/**
 * 网络与代理 (design doc §6.4 / §9.11.3).
 *
 * The shape is Telegram's: one 使用系统代理 switch, then — with the switch off — a
 * short list (直连 / the manual proxy) of which exactly one is in force, and an
 * editor behind 添加代理 and 编辑. The clothes are WeChat's: the same group heading,
 * the same 50 px rows and hairline dividers, and the brand-green disc that
 * `SettingsSelect` puts on its pill marks the row in force.
 *
 * Nothing here decides which proxy is used: main does (`proxy-controller.ts`) and
 * this panel paints the answer.
 */
export function NetworkPanel({ onError }: NetworkPanelProps) {
  const proxy = useProxySettings(onError)
  const [draft, setDraft] = useState<ProxyDraft>(EMPTY_DRAFT)
  const [editing, setEditing] = useState(false)
  const editorRef = useRef<HTMLDivElement | null>(null)

  // The editor is appended under the list, so on a short window its 保存并应用 can
  // sit below the fold; bringing it into view is the whole point of opening it.
  useEffect(() => {
    if (editing) editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [editing])

  const state = proxy.state
  const mode: ProxyMode = state?.mode ?? 'system'
  const config = state?.config ?? null
  const system = state?.system ?? null
  const active = state?.active ?? null

  const toggleSystem = async (next: boolean): Promise<void> => {
    // 跟随系统代理 hides the list and the editor with it: leaving a half-typed
    // endpoint open under a mode that ignores it would be a lie.
    if (next) setEditing(false)
    await proxy.setMode(next ? 'system' : config ? 'manual' : 'off')
  }

  const openEditor = (): void => {
    setDraft(draftFromConfig(config))
    setEditing(true)
    proxy.setStatus({ kind: 'idle' })
  }

  const save = async (): Promise<void> => {
    const next = toProxyConfig(draft)
    if (!next) {
      proxy.setStatus({ kind: 'fail', text: '请填写服务器与端口' })
      return
    }
    await proxy.save(next)
    setEditing(false)
  }

  const test = async (): Promise<void> => {
    const next = toProxyConfig(draft)
    if (!next) {
      proxy.setStatus({ kind: 'fail', text: '请填写服务器与端口' })
      return
    }
    await proxy.test(next)
  }

  const remove = async (): Promise<void> => {
    await proxy.clear()
    setEditing(false)
  }

  const check = (selected: boolean, empty?: boolean) => (
    <span
      className={`wx-set-check${selected ? '' : ' wx-set-check--empty'}${empty ? ' wx-set-check--ghost' : ''}`}
      aria-hidden="true"
    >
      {selected ? '✓' : ''}
    </span>
  )

  return (
    <>
      <SettingsGroup title="代理">
        <SettingsRow label="使用系统代理" description="跟随 Windows 的代理设置，没配置时直连">
          <Switch
            checked={mode === 'system'}
            label="使用系统代理"
            onChange={(next) => void toggleSystem(next)}
          />
        </SettingsRow>

        {mode === 'system' ? (
          <SettingsRow
            label={system ? describeProxy(system) : '系统未配置代理'}
            description={state?.detail ?? (active ? '使用中' : '直连')}
          >
            <button className="wx-set-button" onClick={() => void proxy.refresh()}>
              重新检测
            </button>
          </SettingsRow>
        ) : null}

        <SettingsRow label="优先使用 IPv6" description="网络或代理只有 IPv6 时再打开">
          <Switch
            checked={proxy.preferIpv6}
            label="优先使用 IPv6"
            onChange={(next) => void proxy.toggleIpv6(next)}
          />
        </SettingsRow>
      </SettingsGroup>

      {mode === 'system' ? null : (
        <SettingsGroup title="代理服务器">
          <SettingsRow label="直连" description="不使用任何代理" onClick={() => void proxy.setMode('off')}>
            {check(mode === 'off')}
          </SettingsRow>

          {config ? (
            <div className="wx-set-choice">
              <button type="button" className="wx-set-choice__pick" onClick={() => void proxy.setMode('manual')}>
                {check(mode === 'manual')}
                <span className="wx-set-row__text">
                  <span className="wx-set-row__label">{describeProxy(config)}</span>
                  <span className="wx-set-row__desc">
                    {mode === 'manual' ? (active ? '使用中' : '未生效') : '未使用'}
                  </span>
                </span>
              </button>
              <button className="wx-set-button" onClick={openEditor}>
                编辑
              </button>
            </div>
          ) : (
            <SettingsRow label="添加代理" description="SOCKS5 / HTTP / MTProxy" onClick={openEditor}>
              {check(false, true)}
            </SettingsRow>
          )}
        </SettingsGroup>
      )}

      {editing ? (
        <SettingsGroup title={config ? '编辑代理' : '添加代理'}>
          <div className="wx-set-form" ref={editorRef}>
            <ProxyFields
              draft={draft}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            />
            <div className="wx-set-form__actions">
              <button className="wx-set-button" onClick={() => void save()}>
                保存并应用
              </button>
              <button className="wx-set-button" onClick={() => void test()}>
                测试连通性
              </button>
              {config ? (
                <button
                  className="wx-set-button wx-set-button--danger"
                  onClick={() => void remove()}
                >
                  删除
                </button>
              ) : null}
              <button className="wx-set-button" onClick={() => setEditing(false)}>
                取消
              </button>
            </div>
          </div>
        </SettingsGroup>
      ) : null}

      {proxy.status.kind !== 'idle' ? (
        <p className={proxy.status.kind === 'fail' ? 'wx-set-error' : 'wx-set-muted'}>
          {proxy.status.kind === 'busy' ? '处理中…' : proxy.status.text}
        </p>
      ) : null}
    </>
  )
}
