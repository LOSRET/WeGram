import type { ReactNode } from 'react'

import { ChevronRightIcon } from '../Icon'
import { Switch } from '../Switch'

/**
 * The 聊天信息 rows (design doc §9.9), as small presentational pieces.
 *
 * They are shared by the private and the group layouts, so the measured geometry
 * (64 px link rows, a 10 px-padded switch block, 19/33 px insets) lives here and
 * not in either caller. Nothing in this file talks to IPC.
 */

interface InfoRowProps {
  label: string
  /** The grey line under the label: 群公告's text, or a hint like 群主未设置. */
  hint?: string
  /** Tappable rows are buttons; a read-only row is plain text. */
  onClick?: () => void
}

/** 群聊名称 / 群公告: a 14 px label over its 12 px hint, one tappable block. */
export function InfoRow({ label, hint, onClick }: InfoRowProps) {
  const body = (
    <>
      <span className="wx-info__label">{label}</span>
      {hint ? <span className="wx-info__hint">{hint}</span> : null}
    </>
  )
  if (!onClick) return <div className="wx-info__info">{body}</div>
  return (
    <button type="button" className="wx-info__info wx-info__info--tap" onClick={onClick}>
      {body}
    </button>
  )
}

interface LinkRowProps {
  label: string
  /** Optional glyph before the chevron (群二维码's QR mark). */
  icon?: ReactNode
  onClick: () => void
}

/** 查找聊天内容 / 群二维码: one 64 px row, trailing chevron. */
export function LinkRow({ label, icon, onClick }: LinkRowProps) {
  return (
    <button type="button" className="wx-info__row" onClick={onClick}>
      <span className="wx-info__label">{label}</span>
      {icon}
      <ChevronRightIcon className="wx-info__chevron" />
    </button>
  )
}

interface ToggleRowProps {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}

/** 消息免打扰 / 置顶聊天: a 41 px row ending in the measured switch. */
export function ToggleRow({ label, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className="wx-info__row wx-info__row--toggle">
      <span className="wx-info__label">{label}</span>
      <Switch checked={checked} label={label} disabled={disabled} onChange={onChange} />
    </div>
  )
}

/** 清空聊天记录 / 退出群聊: centred red text. */
export function DangerRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="wx-info__row wx-info__row--clear" onClick={onClick}>
      {label}
    </button>
  )
}
