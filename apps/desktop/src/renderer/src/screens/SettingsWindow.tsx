import type { AppSettings } from '@wegram/protocol'
import { useCallback, useEffect, useState } from 'react'

import { AccountPanel } from '@renderer/components/settings/AccountPanel'
import { AboutPanel } from '@renderer/components/settings/AboutPanel'
import { GeneralPanel } from '@renderer/components/settings/GeneralPanel'
import { NetworkPanel } from '@renderer/components/settings/NetworkPanel'
import { NotificationPanel } from '@renderer/components/settings/NotificationPanel'
import { SettingsNav } from '@renderer/components/settings/SettingsNav'
import type { SettingsSection } from '@renderer/components/settings/SettingsNav'
import { errorMessage, invoke } from '@renderer/lib/ipc'

type SectionKey = 'account' | 'general' | 'notifications' | 'network' | 'about'

/**
 * The groups that exist, in design doc §9.11.3's order. Batch A shipped the four
 * around 消息通知; 消息通知 itself is batch B's first group. The remaining three
 * (快捷键 / 数据与存储 / 隐私与安全) are not drawn as dead rows on purpose.
 */
const SECTIONS: readonly (SettingsSection & { key: SectionKey })[] = [
  { key: 'account', label: '账号与安全' },
  { key: 'general', label: '通用' },
  { key: 'notifications', label: '消息通知' },
  { key: 'network', label: '网络与代理' },
  { key: 'about', label: '关于' },
]

/**
 * 设置, the standalone window (design doc §9.11).
 *
 * It is a second React root and owns no shell state: it fetches what it draws
 * through the settings domain (like the login and 群二维码 windows) and follows the
 * theme through `evt:theme`, so the window that changes the theme is guaranteed to
 * repaint itself too.
 */
export function SettingsWindow() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [section, setSection] = useState<SectionKey>('account')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('settings:get')
      .then((next) => {
        if (cancelled) return
        setSettings(next)
        document.documentElement.dataset['theme'] = next.theme
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () =>
      window.tg.on('evt:theme', (event) => {
        document.documentElement.dataset['theme'] = event.payload.theme
        setSettings((current) => (current ? { ...current, theme: event.payload.theme } : current))
      }),
    [],
  )

  // Esc closes this window only; the shell stays exactly where it is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void invoke('settings:close')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const patch = useCallback(async (next: Partial<AppSettings>): Promise<void> => {
    setSettings((current) => (current ? { ...current, ...next } : current))
    try {
      await invoke('settings:set', { patch: next })
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [])

  return (
    <div className="wx-settings">
      {/* The window is frameless: the top 40 px is the grab strip. */}
      <div className="wx-settings__drag" />
      <button
        type="button"
        className="wx-settings__close"
        title="关闭"
        aria-label="关闭"
        onClick={() => void invoke('settings:close')}
      >
        ×
      </button>

      <SettingsNav
        sections={SECTIONS}
        active={section}
        onSelect={(key) => {
          // Only a key from this table may become the active section; the nav's
          // callback carries a plain string because it is generic over its items.
          const next = SECTIONS.find((candidate) => candidate.key === key)
          if (next) setSection(next.key)
        }}
      />

      <div className="wx-settings__body">
        {error ? <div className="wx-set-error">{error}</div> : null}
        {section === 'account' ? <AccountPanel /> : null}
        {section === 'general' && settings ? (
          <GeneralPanel settings={settings} onChange={(next) => void patch(next)} />
        ) : null}
        {section === 'notifications' ? <NotificationPanel /> : null}
        {section === 'network' ? <NetworkPanel onError={setError} /> : null}
        {section === 'about' ? <AboutPanel /> : null}
      </div>
    </div>
  )
}
