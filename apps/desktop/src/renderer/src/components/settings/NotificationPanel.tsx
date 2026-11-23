import type {
  NotificationScope,
  NotificationScopes,
  ScopeNotificationSettings,
} from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '@renderer/lib/ipc'

import { Switch } from '../Switch'
import { SettingsGroup } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'

const SCOPES: readonly { key: NotificationScope; title: string }[] = [
  { key: 'private', title: '私聊' },
  { key: 'group', title: '群聊' },
  { key: 'channel', title: '频道' },
]

/**
 * 消息通知, batch B's first group (design doc §9.11.3).
 *
 * Two owners are painted side by side on purpose: 桌面通知 is this machine's own
 * switch (ui.db), while the three scopes are the account's defaults in TDLib, the
 * ones another device sees too. The three switches are optimistic — a switch that
 * waits for a server round trip feels broken — and a rejected write puts the old
 * value back with the error line the other panels use.
 */
export function NotificationPanel() {
  const [desktop, setDesktop] = useState<boolean | null>(null)
  const [scopes, setScopes] = useState<NotificationScopes | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('notifications:get')
      .then((state) => {
        if (cancelled) return
        setDesktop(state.desktop)
        setScopes(state.scopes)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleDesktop = async (next: boolean): Promise<void> => {
    setDesktop(next)
    try {
      await invoke('notifications:setDesktop', { desktop: next })
    } catch (failure) {
      setDesktop(!next)
      setError(errorMessage(failure))
    }
  }

  const patchScope = async (
    scope: NotificationScope,
    patch: Partial<ScopeNotificationSettings>,
  ): Promise<void> => {
    if (!scopes) return
    const previous = scopes[scope]
    const next = { ...previous, ...patch }
    setScopes({ ...scopes, [scope]: next })
    try {
      await invoke('notifications:setScope', { scope, settings: next })
    } catch (failure) {
      setScopes((current) => (current ? { ...current, [scope]: previous } : current))
      setError(errorMessage(failure))
    }
  }

  const current = scopes

  return (
    <>
      <SettingsGroup title="通知">
        <SettingsRow label="桌面通知" description="在系统通知中心弹出新消息提醒">
          <Switch
            checked={desktop === true}
            // Nothing to flip before the read lands: painting it "on" from a default
            // would let the reader change a switch the panel never saw.
            disabled={desktop === null}
            label="桌面通知"
            onChange={(next) => void toggleDesktop(next)}
          />
        </SettingsRow>
      </SettingsGroup>

      <p className="wx-set-note">各类会话的默认值；单个会话自己的免打扰优先于这里。</p>

      {current
        ? SCOPES.map(({ key, title }) => (
            <SettingsGroup key={key} title={title}>
              <SettingsRow label="消息免打扰">
                <Switch
                  label={title + '消息免打扰'}
                  checked={current[key].muted}
                  onChange={(next) => void patchScope(key, { muted: next })}
                />
              </SettingsRow>
              <SettingsRow label="提示音">
                <Switch
                  label={title + '提示音'}
                  checked={current[key].sound}
                  onChange={(next) => void patchScope(key, { sound: next })}
                />
              </SettingsRow>
              <SettingsRow label="显示消息内容">
                <Switch
                  label={title + '显示消息内容'}
                  checked={current[key].showPreview}
                  onChange={(next) => void patchScope(key, { showPreview: next })}
                />
              </SettingsRow>
            </SettingsGroup>
          ))
        : null}

      {!current && !error ? <p className="wx-set-muted">正在读取…</p> : null}
      {error ? <div className="wx-set-error">{error}</div> : null}
    </>
  )
}
