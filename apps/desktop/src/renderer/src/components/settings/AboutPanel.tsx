import type { AppInfo } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '@renderer/lib/ipc'

import { SettingsGroup } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'

/** 关于: version, the protocol layer and the non-official disclaimer (§9.11.3). */
export function AboutPanel() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('app:info')
      .then((next) => {
        if (!cancelled) setInfo(next)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <SettingsGroup title="关于 WeGram">
        <SettingsRow label="版本">{info ? `v${info.appVersion}` : '…'}</SettingsRow>
        <SettingsRow label="协议层">
          {info ? (info.adapter === 'mock' ? 'Mock 适配器（开发）' : 'TDLib') : '…'}
        </SettingsRow>
        <SettingsRow label="开源组件" description="qrcode · lottie-web · TDLib · Electron">
          <span className="wx-set-muted">MIT / Apache-2.0</span>
        </SettingsRow>
      </SettingsGroup>

      {error ? <div className="wx-set-error">{error}</div> : null}

      <p className="wx-set-disclaimer">
        WeGram 是非官方的 Telegram 桌面客户端，与 Telegram Messenger LLP 无隶属关系。所有聊天数据由
        Telegram 服务端提供，本应用不收集、不上传任何内容。
      </p>
    </>
  )
}
