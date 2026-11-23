import type {
  AppSettings,
  AppSettingsPatch,
  CloseBehavior,
  MessageTextSize,
  SendKey,
  ThemePreference,
} from '@wegram/protocol'

import { Switch } from '../Switch'
import { SettingsGroup } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import { SettingsSelect } from './SettingsSelect'

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

const SIZE_OPTIONS: readonly { value: MessageTextSize; label: string }[] = [
  { value: 'small', label: '小' },
  { value: 'standard', label: '标准' },
  { value: 'large', label: '大' },
  { value: 'xlarge', label: '超大' },
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
  onChange: (patch: AppSettingsPatch) => void
}

/**
 * 通用: the appearance / 消息字号 / close / send-key / 开机自启 preferences
 * (design doc §9.11.3).
 *
 * Everything here is local — nothing on this panel talks to TDLib. 开机自启 is the
 * one row whose truth lives outside the app (the OS login item), which is why the
 * panel paints `launchAtLogin` from `settings:get` and only offers the write when
 * this build is allowed to make it (`canLaunchAtLogin`).
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
        <SettingsRow label="消息字号" description="聊天里正文的文字大小">
          <SettingsSelect
            label="消息字号"
            value={settings.messageTextSize}
            options={SIZE_OPTIONS}
            onChange={(next) => onChange({ messageTextSize: next })}
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

      <SettingsGroup title="启动">
        <SettingsRow
          label="开机自启"
          description={settings.canLaunchAtLogin ? '登录 Windows 后自动启动 WeGram' : '仅安装版可用'}
        >
          <Switch
            label="开机自启"
            checked={settings.launchAtLogin}
            disabled={!settings.canLaunchAtLogin}
            onChange={(next) => onChange({ launchAtLogin: next })}
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
