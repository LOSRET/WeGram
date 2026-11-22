import type { AppSettings, CloseBehavior, SendKey, ThemePreference } from '@wegram/protocol'

import { SettingsGroup } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import { SettingsSelect } from './SettingsSelect'

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

const CLOSE_OPTIONS: readonly { value: CloseBehavior; label: string }[] = [
  { value: 'tray', label: '最小化到托盘' },
  { value: 'quit', label: '退出程序' },
]

const SEND_OPTIONS: readonly { value: SendKey; label: string }[] = [
  { value: 'enter', label: 'Enter' },
  { value: 'ctrlEnter', label: 'Ctrl+Enter' },
]

interface GeneralPanelProps {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}

/**
 * 通用: the appearance / close / send-key preferences (design doc §9.11.3).
 * Everything here is local — nothing on this panel talks to TDLib.
 */
export function GeneralPanel({ settings, onChange }: GeneralPanelProps) {
  return (
    <>
      <SettingsGroup title="界面与显示">
        <SettingsRow label="外观">
          <SettingsSelect
            label="外观"
            value={settings.themePreference}
            options={THEME_OPTIONS}
            onChange={(next) => onChange({ themePreference: next })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="窗口">
        <SettingsRow label="关闭主窗口" description="点主窗口的 × 时做什么">
          <SettingsSelect
            label="关闭主窗口"
            value={settings.closeBehavior}
            options={CLOSE_OPTIONS}
            onChange={(next) => onChange({ closeBehavior: next })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="消息">
        <SettingsRow label="发送消息" description="Shift+Enter 始终换行">
          <SettingsSelect
            label="发送消息"
            value={settings.sendKey}
            options={SEND_OPTIONS}
            onChange={(next) => onChange({ sendKey: next })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}
