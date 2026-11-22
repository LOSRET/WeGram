import type { ReactNode } from 'react'

interface SettingsRowProps {
  label: string
  /** The smaller grey line under the label (the client's two-line row). */
  description?: string
  /** The control on the right (a select, a switch, a button, a value). */
  children?: ReactNode
  /** A whole-row action; when absent the row is a plain label/value line. */
  onClick?: () => void
}

/**
 * One 设置 row: label (and an optional caption) on the left, control on the right.
 *
 * The client draws a hairline between rows but not around them, which is why the
 * line belongs to the row rather than to a list.
 */
export function SettingsRow({ label, description, children, onClick }: SettingsRowProps) {
  const body = (
    <>
      <span className="wx-set-row__text">
        <span className="wx-set-row__label">{label}</span>
        {description ? <span className="wx-set-row__desc">{description}</span> : null}
      </span>
      {children ? <span className="wx-set-row__control">{children}</span> : null}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className="wx-set-row wx-set-row--action" onClick={onClick}>
        {body}
      </button>
    )
  }
  return <div className={`wx-set-row${description ? ' wx-set-row--tall' : ''}`}>{body}</div>
}
