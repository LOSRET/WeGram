import { errorMessage, invoke } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/useAppStore'
import { useState } from 'react'

interface TitleBarProps {
  query: string
  onQueryChange: (value: string) => void
  onOpenSettings: () => void
}

export function TitleBar({ query, onQueryChange, onOpenSettings }: TitleBarProps) {
  const info = useAppStore((state) => state.info)
  const connection = useAppStore((state) => state.connection)
  const theme = useAppStore((state) => state.theme)
  const [busy, setBusy] = useState(false)

  const toggleTheme = async () => {
    const store = useAppStore.getState()
    const next = store.theme === 'light' ? 'dark' : 'light'
    store.setTheme(next)
    try {
      await invoke('settings:set', { patch: { theme: next } })
    } catch (error) {
      store.setError(errorMessage(error))
    }
  }

  const logout = async () => {
    setBusy(true)
    try {
      await invoke('auth:logout')
      useAppStore.getState().reset()
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="wx-titlebar">
      <div className="wx-titlebar__brand">
        WechatGram
        <span className="wx-titlebar__badge">{info?.adapter === 'mock' ? 'MOCK' : 'TDLIB'}</span>
      </div>

      <input
        className="wx-search"
        placeholder="搜索会话"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />

      <div className="wx-titlebar__spacer" />

      <span className={`wx-connection wx-connection--${connection}`}>{connectionLabel(connection)}</span>

      <button className="wx-icon-button" onClick={() => void toggleTheme()} title="切换主题">
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
      <button className="wx-icon-button" onClick={onOpenSettings} title="设置">
        ⚙
      </button>
      <button className="wx-icon-button" onClick={() => void logout()} title="退出登录" disabled={busy}>
        ⎋
      </button>
    </header>
  )
}

function connectionLabel(connection: string): string {
  switch (connection) {
    case 'online':
      return '已连接'
    case 'connecting':
      return '连接中…'
    case 'updating':
      return '同步中…'
    default:
      return '离线'
  }
}
