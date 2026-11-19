import { errorMessage, invoke } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/useAppStore'
import { useState } from 'react'

import { Popup } from './ContextMenu'

interface AppMenuProps {
  x: number
  y: number
  onClose: () => void
  onOpenSettings: () => void
}

/**
 * WeChat 4.x only exposes a three-line "settings" button at the bottom of the
 * rail. Theme and sign-out live behind it because the strip has no title bar to
 * hang them on.
 */
export function AppMenu({ x, y, onClose, onOpenSettings }: AppMenuProps) {
  const theme = useAppStore((state) => state.theme)
  const info = useAppStore((state) => state.info)
  const [busy, setBusy] = useState(false)

  const toggleTheme = async (): Promise<void> => {
    onClose()
    const store = useAppStore.getState()
    const next = store.theme === 'light' ? 'dark' : 'light'
    store.setTheme(next)
    try {
      await invoke('settings:set', { patch: { theme: next } })
    } catch (error) {
      store.setError(errorMessage(error))
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('auth:logout')
      useAppStore.getState().reset()
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
      onClose()
    }
  }

  return (
    <Popup x={x} y={y} onClose={onClose}>
      <button
        className="wx-context-menu__item"
        onClick={() => {
          onClose()
          onOpenSettings()
        }}
      >
        设置
      </button>
      <button className="wx-context-menu__item" onClick={() => void toggleTheme()}>
        {theme === 'light' ? '深色模式' : '浅色模式'}
      </button>
      <button
        className="wx-context-menu__item wx-context-menu__item--danger"
        onClick={() => void logout()}
        disabled={busy}
      >
        {busy ? '正在退出…' : '退出登录'}
      </button>
      <div className="wx-context-menu__separator" />
      <div className="wx-context-menu__caption">
        {info?.adapter === 'mock' ? 'Mock 适配器' : 'TDLib'} · v{info?.appVersion ?? 'dev'}
      </div>
    </Popup>
  )
}
